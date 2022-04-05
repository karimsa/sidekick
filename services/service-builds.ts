import globby from 'globby';
import maxBy from 'lodash/maxBy';
import { ServiceBuildHistoryModel } from '../server/models/ServiceBuildHistory.model';
import { ServiceConfig } from './service-list';
import { AbortController } from 'node-abort-controller';
import { ExecUtils } from '../utils/exec';
import { ConfigManager } from './config';
import { makeChan, select } from 'rsxjs';

export class ServiceBuildsService {
	static async getServiceLastUpdated(serviceConfig: ServiceConfig) {
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

	static async getServiceLastBuilt(serviceConfig: ServiceConfig) {
		const buildEntry = await ServiceBuildHistoryModel.getLastBuildEntry(
			serviceConfig,
		);
		return buildEntry?.lastBuiltTime ?? null;
	}

	static async isServiceStale(serviceConfig: ServiceConfig) {
		const [lastBuiltAt, lastUpdatedAt] = await Promise.all([
			this.getServiceLastBuilt(serviceConfig),
			this.getServiceLastUpdated(serviceConfig),
		]);
		return !lastBuiltAt || !lastUpdatedAt || lastBuiltAt < lastUpdatedAt;
	}

	static async *buildServices(
		services: ServiceConfig[],
		abortController: AbortController,
	) {
		const buildStart = new Date();
		const outputChan = makeChan();
		const doneChan = makeChan<null>();
		const errorChan = makeChan();

		// TODO: Run with yarn too
		ExecUtils.runCommand(
			'lerna',
			[
				'run',
				'prepare',
				'--stream',
				...services.map((serviceConfig) => `--scope=${serviceConfig.name}`),
			],
			{
				cwd: await ConfigManager.getProjectPath(),
				abortController,
				onStdout(chunk) {
					outputChan.put(chunk);
				},
			},
		)
			.then(() => doneChan.put(null))
			.catch((error) => {
				errorChan.put(error);
			});

		while (true) {
			const { chunk, error } = await select({
				[outputChan]: (chunk) => ({ chunk, error: null }),
				[errorChan]: (error) => ({ chunk: null, error }),
				[doneChan]: () => ({ chunk: null, error: null }),
			});
			if (chunk) {
				yield chunk;
			} else if (error) {
				throw error;
			} else {
				break;
			}
		}

		await Promise.all(
			services.map((serviceConfig) =>
				ServiceBuildHistoryModel.updateLastBuildEntry(
					serviceConfig,
					buildStart,
				),
			),
		);
	}
}
