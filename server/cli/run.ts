import { ServiceList } from '../services/service-list';
import { createCommand } from './createCommand';
import { z } from 'zod';
import execa from 'execa';
import * as path from 'path';

createCommand({
	name: 'run',
	description: 'Run a command within a set of packages',
	options: z.object({
		tag: z.string().optional().describe('Filter services by given tag'),
	}),
	async action({ tag, projectDir, args }) {
		const cmd = args[0];
		if (!cmd) {
			throw new Error(`Must specify a command to run`);
		}

		const services = tag
			? await ServiceList.getServicesByTag(tag)
			: await ServiceList.getServices();

		const child = execa.command(
			[
				`${path.resolve(__dirname, 'node_modules/.bin')}/lerna`,
				`run`,
				cmd,
				`--stream`,
				...services.map((s) => `--scope ${s.name}`),
			].join(' '),
			{
				buffer: false,
				stdin: 'pipe',
				cwd: projectDir,
			},
		);

		child.stdout!.pipe(process.stdout);
		child.stderr!.pipe(process.stderr);

		await child;
	},
});
