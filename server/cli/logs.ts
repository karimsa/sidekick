import { createCommand } from './createCommand';
import { z } from 'zod';
import { ServiceList } from '../../services/service-list';
import { ProcessManager } from '../../utils/process-manager';
import { split } from '../utils/split';
import chalk from 'chalk';
import { isActiveStatus } from '../../utils/shared-types';
import { HealthService } from '../../services/health';

const colors = [chalk.yellow, chalk.cyan, chalk.magenta, chalk.red];

let lastColor = -1;
function getNextColor() {
	return colors[lastColor++ % colors.length];
}

const isJson = (data: string) => {
	if (data[0] !== '{') {
		return false;
	}
	try {
		JSON.parse(data);
		return true;
	} catch {
		return false;
	}
};

createCommand({
	name: 'logs',
	description: 'Display the logs for a running service',
	options: z.object({
		service: z.string().optional().describe('Name of the service'),
		tag: z.string().optional().describe('Include services with this tag'),
		process: z
			.string()
			.optional()
			.describe('Name of the process under the service'),
		count: z
			.number()
			.int()
			.optional()
			.describe('Number of lines to display from end of log'),
		follow: z
			.boolean()
			.optional()
			.describe('If true, will keep the logs connected and streaming'),
		json: z
			.boolean()
			.optional()
			.describe('If true, will only show lines that contain valid json'),
	}),
	async action({
		service: serviceName,
		tag,
		process: devServerFilter,
		follow,
		count,
		json,
	}) {
		const serviceConfigs = serviceName
			? [await ServiceList.getService(serviceName)]
			: tag
			? await ServiceList.getServicesByTag(tag)
			: [];
		if (serviceConfigs.length === 0) {
			throw new Error(`Specify either --service or --tag`);
		}

		await Promise.all(
			serviceConfigs.flatMap(async (serviceConfig) => {
				if (
					!isActiveStatus(
						(await HealthService.getServiceHealth(serviceConfig.name))
							.healthStatus,
					)
				) {
					return;
				}

				return Object.keys(serviceConfig.devServers)
					.filter((key) => !devServerFilter || key === devServerFilter)
					.map(
						(devServer) =>
							new Promise<void>((resolve, reject) => {
								const colorize = getNextColor();
								const serviceLabel = colorize(`[${devServer}]`);

								ProcessManager.watchLogs({
									name: ProcessManager.getScopedName(
										serviceConfig.name,
										devServer,
									),
									lines: count,
									follow: !!follow,
								})
									.pipe(split(/\r?\n/g))
									.subscribe({
										next: (data) => {
											if (json && isJson(data)) {
												process.stdout.write(
													(devServerFilter ? data : `${serviceLabel} ${data}`) +
														'\n',
												);
											} else if (!json) {
												process.stdout.write(
													(devServerFilter ? data : `${serviceLabel} ${data}`) +
														'\n',
												);
											}
										},
										error: (err) => reject(err),
										complete: () => resolve(),
									});
							}),
					);
			}),
		);
	},
});
