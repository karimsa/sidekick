import globby from 'globby';
import maxBy from 'lodash/maxBy';
import chokidar, { FSWatcher } from 'chokidar';
import { Stats } from 'fs';
import { ServiceBuildHistoryModel } from '../models/ServiceBuildHistory.model';
import { ServiceConfig, ServiceList } from './service-list';
import { ExecUtils } from '../utils/exec';
import { ConfigManager } from './config';
import { Observable } from 'rxjs';
import path from 'path';
import { startTask } from '../utils/TaskRunner';
import isEqual from 'lodash/isEqual';
import { memoize } from '../utils/memoize';
import { getService } from '../controllers/servers';

interface ServiceFilesUpdated {
	config: ServiceConfig;
	sourceWatcher?: FSWatcher;
	outputWatcher?: FSWatcher;
	outputLastUpdated: Date | null;
	sourceLastUpdated: Date | null;
}

const chokidarConfig = {
	persistent: true,
	alwaysStat: true,
	ignoreInitial: true,
};

class ServiceBuildListenerTask {
	constructor(private serviceInfo: Map<string, ServiceFilesUpdated>) {}

	private createListener(service: ServiceConfig, kind: 'output' | 'source') {
		return (path: string, stats?: Stats) => {
			const previous = this.serviceInfo.get(service.location);
			if (!previous) {
				return;
			}

			const key = `${kind}LastUpdated` as const;
			const previousDate = previous[key] ?? new Date(0);
			this.serviceInfo.set(service.location, {
				...previous,
				[key]: new Date(Math.max(+previousDate, +stats!.mtime)),
			});
		};
	}

	async run() {
		const newServices: ServiceConfig[] = [];
		const oldServices: ServiceFilesUpdated[] = [];

		const freshServices = await ServiceList.getServices();
		for (const service of freshServices) {
			const prev = this.serviceInfo.get(service.location);
			if (isEqual(prev?.config, service)) {
				continue;
			}

			// TODO: this is inefficient in the case that we
			// 	change the source/output files lists.
			if (prev) {
				oldServices.push(prev);
			}

			newServices.push(service);
		}

		for (const service of oldServices) {
			await service.sourceWatcher?.close();
			await service.outputWatcher?.close();
		}

		for (const service of newServices) {
			const { sourceFiles, outputFiles } = service;
			const sourceWatcher = chokidar.watch(
				sourceFiles.map((filePath) => path.resolve(service.location, filePath)),
				chokidarConfig,
			);
			sourceWatcher
				.on('change', this.createListener(service, 'source'))
				.on('error', (e: any, path: string) =>
					console.error('error in source watcher: ', e, path),
				);

			const outputWatcher = chokidar.watch(
				outputFiles.map((filePath) => path.resolve(service.location, filePath)),
				chokidarConfig,
			);
			outputWatcher
				.on('change', this.createListener(service, 'output'))
				.on('error', (e: any, path: string) =>
					console.error('error in source watcher: ', e, path),
				);

			const prev = this.serviceInfo.get(service.location);
			this.serviceInfo.set(service.location, {
				config: service,
				sourceWatcher,
				outputWatcher,
				sourceLastUpdated: prev?.sourceLastUpdated ?? null,
				outputLastUpdated: prev?.outputLastUpdated ?? null,
			});
		}
	}
}

const getServiceInfo = memoize(async () => {
	const serviceInfo = new Map<string, ServiceFilesUpdated>();
	const services = await ServiceList.getServices();
	for (const service of services) {
		const globbyConfig = {
			objectMode: true,
			cwd: service.location,
			expandDirectories: true,
			stats: true,
		} as const;

		const sourceEntries = await globby(service.sourceFiles, globbyConfig);
		const outputEntries = await globby(service.outputFiles, globbyConfig);

		const lastModifiedSource = maxBy(
			sourceEntries,
			(entry) => +entry.stats!.mtime,
		);
		const lastModifiedOutput = maxBy(
			outputEntries,
			(entry) => +entry.stats!.mtime,
		);

		serviceInfo.set(service.location, {
			config: service,
			sourceLastUpdated: lastModifiedSource?.stats!.mtime ?? null,
			outputLastUpdated: lastModifiedOutput?.stats!.mtime ?? null,
		});
	}

	return serviceInfo;
});

startTask('watchTask', async () => {
	const serviceInfo = await getServiceInfo();
	const task = new ServiceBuildListenerTask(serviceInfo);
	while (true) {
		await task.run();
		await new Promise((res) => setTimeout(res, 10_000));
	}
});

export class ServiceBuildsService {
	static async getServiceSourceLastUpdated(service: ServiceConfig) {
		const info = await getServiceInfo();
		return info.get(service.location)?.sourceLastUpdated ?? null;
	}

	static async getServiceOutputLastUpdated(service: ServiceConfig) {
		const info = await getServiceInfo();
		return info.get(service.location)?.outputLastUpdated ?? null;
	}

	static async getServiceLastBuilt(serviceConfig: ServiceConfig) {
		const [buildEntry, outputLastUpdated] = await Promise.all([
			ServiceBuildHistoryModel.getLastBuildEntry(serviceConfig),
			this.getServiceOutputLastUpdated(serviceConfig),
		]);

		const buildEntryLastBuilt = buildEntry?.lastBuiltTime ?? new Date(0);
		const lastOutputUpdated = outputLastUpdated ?? new Date(0);

		return new Date(Math.max(+buildEntryLastBuilt, +lastOutputUpdated));
	}

	static async isServiceStale(serviceConfig: ServiceConfig) {
		if (serviceConfig.disableStaleChecks) {
			return false;
		}

		const [lastBuiltAt, lastUpdatedAt] = await Promise.all([
			this.getServiceLastBuilt(serviceConfig),
			this.getServiceSourceLastUpdated(serviceConfig),
		]);

		// there's no source files, can't be stale
		if (!lastUpdatedAt) {
			return false;
		}
		return !lastBuiltAt || lastBuiltAt < lastUpdatedAt;
	}

	static async buildService(serviceConfig: ServiceConfig) {
		const projectPath = await ConfigManager.getProjectPath();
		return new Observable<string>((subscriber) => {
			const buildStart = new Date();
			subscriber.next(
				`Running 'yarn prepare' in ${path.relative(
					projectPath,
					serviceConfig.location,
				)}\n\n`,
			);
			ExecUtils.runAndStream(`yarn prepare`, {
				cwd: serviceConfig.location,
			}).subscribe({
				next: (data) => subscriber.next(data),
				error: (err) => subscriber.error(err),
				complete: async () => {
					ServiceBuildHistoryModel.updateLastBuildEntry(
						serviceConfig,
						buildStart,
					)
						.then(() => subscriber.complete())
						.catch((err) => subscriber.error(err));
				},
			});
		});
	}

	static async buildServices(services: ServiceConfig[]) {
		if (services.length === 0) {
			throw new Error(`Cannot build zero services`);
		}

		const projectPath = await ConfigManager.getProjectPath();
		return new Observable<string>((subscriber) => {
			const buildStart = new Date();
			ExecUtils.runAndStream(
				`lerna run prepare --stream ${services
					.map((serviceConfig) => `--scope=${serviceConfig.name}`)
					.join(' ')}`,
				{
					cwd: projectPath,
				},
			).subscribe({
				next: (data) => subscriber.next(data),
				error: (err) => subscriber.error(err),
				complete: () => {
					Promise.all(
						services.map((serviceConfig) =>
							ServiceBuildHistoryModel.updateLastBuildEntry(
								serviceConfig,
								buildStart,
							),
						),
					)
						.then(() => subscriber.complete())
						.catch((err) => subscriber.error(err));
				},
			});
		});
	}
}
