import { fmt } from '../../utils/fmt';
import { version } from '../../package.json';
import { createCommand } from './createCommand';
import { z } from 'zod';

createCommand({
	name: 'version',
	description: 'Print version info',
	options: z.object({}),
	async action() {
		console.log(
			fmt`${{
				sidekick: version,
				node: process.version,
			}}`,
		);
	},
});
