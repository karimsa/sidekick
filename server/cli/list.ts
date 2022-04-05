import { ServiceList } from '../../services/service-list';
import { createCommand } from './createCommand';
import { z } from 'zod';
import { printTable } from '../utils/printTable';
import { ServiceBuildsService } from '../../services/service-builds';

createCommand({
	name: 'list',
	description: 'List all services in the project',
	options: z.object({
		json: z.boolean().default(false).describe('Print output as json'),
		tag: z.string().optional().describe('Filter services by given tag'),
	}),
	async action({ json, tag }) {
		const services = (await ServiceList.getServices()).filter(
			(service) => !tag || service.tags.includes(tag),
		);
		if (json) {
			console.log(JSON.stringify(services, null, '\t'));
		} else {
			console.log(
				printTable(
					['Name', 'Tags', 'Last updated'],
					await Promise.all(
						services.map(async (service) => [
							service.name,
							service.tags.length === 0 ? '-' : service.tags.join(', '),
							(
								await ServiceBuildsService.getServiceLastUpdated(service)
							)?.toLocaleString() ?? 'never',
						]),
					),
				),
			);
		}
	},
});
