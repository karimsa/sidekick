import globby from 'globby';
import maxBy from 'lodash/maxBy';
import { ServiceBuildHistoryModel } from '../models/ServiceBuildHistory.model';
import { ServiceConfig, ServiceList } from './service-list';
import { ExecUtils } from '../utils/exec';
import { ConfigManager } from './config';
import { Observable } from 'rxjs';
import path from 'path';

export class ServiceBuildsService {
	static async getServiceSourceLastUpdated(serviceConfig: ServiceConfig) {
		const sourceEntries = await globby(serviceConfig.sourceFiles, {
			objectMode: true,
			cwd: serviceConfig.location,
			expandDirectories: true,
			stats: true,
		});
		const lastModifiedEntry = maxBy(
			sourceEntries,
			(entry) => +entry.stats!.mtime,
		);
		return lastModifiedEntry?.stats!.mtime ?? null;
	}

	static async getServiceOutputLastUpdated(serviceConfig: ServiceConfig) {
		const sourceEntries = await globby(serviceConfig.outputFiles, {
			objectMode: true,
			cwd: serviceConfig.location,
			expandDirectories: true,
			stats: true,
		});
		const lastModifiedEntry = maxBy(
			sourceEntries,
			(entry) => +entry.stats!.mtime,
		);
		return lastModifiedEntry?.stats!.mtime ?? null;
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

	static async getStaleServices() {
		const services = await ServiceList.getServices();
		return (
			await Promise.all(
				services.map(async (service) => {
					if (await ServiceBuildsService.isServiceStale(service)) {
						return [service];
					}
					return [];
				}),
			)
		).flat();
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
