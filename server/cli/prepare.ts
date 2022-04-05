import { createCommand } from './createCommand';
import { z } from 'zod';
import { ServiceList } from '../../services/service-list';
import { ServiceBuildsService } from '../../services/service-builds';
import { AbortController } from 'node-abort-controller';
import { fmt } from '../../utils/fmt';

createCommand({
	name: 'prepare',
	description: 'Build a service',
	options: z.object({
		name: z.string().optional().describe('Name of the service to build'),
		force: z
			.boolean()
			.optional()
			.describe('Force build services, even if they are up-to-date'),
		dryRun: z
			.boolean()
			.optional()
			.describe('Skip building, and only print information'),
	}),
	async action({ name, dryRun, force }) {
		if (name) {
			const serviceConfig = await ServiceList.getService(name);
			if (
				!force &&
				!(await ServiceBuildsService.isServiceStale(serviceConfig))
			) {
				console.warn(`Service already up-to-date`);
				return;
			}
			if (dryRun) {
				console.log(`${name} is stale and can be rebuilt`);
				return;
			}

			for await (const chunk of ServiceBuildsService.buildServices(
				[serviceConfig],
				new AbortController(),
			)) {
				process.stdout.write(chunk);
			}
		} else {
			const services = await ServiceList.getServices();
			const staleServices = (
				await Promise.all(
					services.map(async (service) => {
						if (force || (await ServiceBuildsService.isServiceStale(service))) {
							return [service];
						}
						return [];
					}),
				)
			).flat();

			if (dryRun) {
				console.log(
					fmt`Found ${staleServices.length} stale services: ${staleServices.map(
						(service) => service.name,
					)}`,
				);
				return;
			}

			for await (const chunk of ServiceBuildsService.buildServices(
				staleServices,
				new AbortController(),
			)) {
				process.stdout.write(chunk);
			}
		}
	},
});
