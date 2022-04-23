import { createCommand } from './createCommand';
import { z } from 'zod';
import { ServiceList } from '../../services/service-list';
import { ProcessManager } from '../../utils/process-manager';
import { split } from '../utils/split';

createCommand({
	name: 'logs',
	description: 'Display the logs for a running service',
	options: z.object({
		service: z.string().describe('Name of the service'),
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
	}),
	async action({
		service: serviceName,
		process: devServerFilter,
		follow,
		count,
	}) {
		const serviceConfig = await ServiceList.getService(serviceName);
		await Promise.all(
			Object.keys(serviceConfig.devServers)
				.filter((key) => !devServerFilter || key === devServerFilter)
				.map(
					(devServer) =>
						new Promise<void>((resolve, reject) => {
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
									next: (data) =>
										process.stdout.write(
											(devServerFilter ? data : `[${devServer}] ${data}`) +
												'\n',
										),
									error: (err) => reject(err),
									complete: () => resolve(),
								});
						}),
				),
		);
	},
});