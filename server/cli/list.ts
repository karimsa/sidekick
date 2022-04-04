import { ServiceList } from '../../services/service-list';
import { createCommand } from './createCommand';
import { z } from 'zod';
import { printTable } from '../utils/printTable';

createCommand({
	name: 'list',
	description: 'List all services in the project',
	options: z.object({
		json: z.boolean().default(false).describe('Print output as json'),
	}),
	async action({ json }) {
		const services = await ServiceList.getServices();
		if (json) {
			console.log(JSON.stringify(services, null, '\t'));
		} else {
			console.log(
				printTable(
					['Name', 'Tags'],
					services.map((service) => [
						service.name,
						service.tags.length === 0 ? '-' : service.tags.join(', '),
					]),
				),
			);
		}
	},
});
