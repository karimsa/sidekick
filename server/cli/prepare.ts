import { createCommand } from './createCommand';
import { z } from 'zod';
import { ServiceList } from '../services/service-list';
import { ServiceBuildsService } from '../services/service-builds';
import { HealthService } from '../services/health';
import { HealthStatus } from '../utils/shared-types';
import { fmt } from '../utils/fmt';

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
			const serviceHealth = await HealthService.getServiceHealth(
				serviceConfig.name,
			);

			if (!force && serviceHealth.healthStatus === HealthStatus.stale) {
				console.warn(`Service is not currently stale`);
				return;
			}
			if (dryRun) {
				console.log(`${name} is stale and can be rebuilt`);
				return;
			}

			const observable = await ServiceBuildsService.buildService(serviceConfig);
			observable.subscribe({
				next: (data) => process.stdout.write(data),
				error: (err) => {
					process.stderr.write(`${err}`);
					process.exit(1);
				},
			});
		} else {
			const staleServices = force
				? await ServiceList.getServices()
				: await HealthService.getStaleServices();

			if (staleServices.length === 0) {
				console.log(`Found zero stale services`);
				return;
			}

			if (dryRun) {
				console.log(
					fmt`Found ${staleServices.length} stale services: ${staleServices.map(
						(service) => service.name,
					)}`,
				);
				return;
			}

			const observable = await ServiceBuildsService.buildServices(
				staleServices,
			);
			await new Promise<void>((resolve, reject) => {
				observable.subscribe({
					next: (data) => process.stdout.write(data),
					error: (err) => reject(err),
					complete: () => resolve(),
				});
			});
		}
	},
});
