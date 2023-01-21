import { z } from 'zod';
import { createCommand } from './createCommand';

createCommand({
	name: 'upgrade',
	description: 'DEPRECATED: Please use sidekick-upgrade instead',
	options: z.object({}),
	async action() {
		throw new Error(
			`sidekick upgrade is now deprecated. Please use sidekick-upgrade instead.`,
		);
	},
});
