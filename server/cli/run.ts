import execa from 'execa';
import * as path from 'path';
import { z } from 'zod';
import { ServiceList } from '../services/service-list';
import { createCommand } from './createCommand';

createCommand({
	name: 'run',
	description: 'Run a command within a set of packages',
	options: z.object({
		tag: z.string().optional().describe('Filter services by given tag'),
		name: z.string().optional().describe('Target a specific service by name'),
		includeDependencies: z.boolean().optional().describe('Include dependencies of the target service(s)'),
		dryRun: z.boolean().optional().describe('Print the command that would be run'),
	}),
	async action({ tag, projectDir, args, name, includeDependencies, dryRun }) {
		const cmd = args[0];
		if (!cmd) {
			throw new Error(`Must specify a command to run`);
		}

		if (name && tag) {
			throw new Error(`Cannot specify both name and tag`);
		}

		const allServices = await ServiceList.getServices();
		const initialServices = tag
			? await ServiceList.getServicesByTag(tag)
			: name ? [await ServiceList.getService(name)]
			: await ServiceList.getServices();
		const services = includeDependencies ? [
			...initialServices,
			...initialServices.flatMap(service => ServiceList.getServiceDependencies(service.name, allServices))
		] : initialServices;

		const targetCmd = [
			`${path.resolve(__dirname, 'node_modules/.bin')}/lerna`,
			`run`,
			cmd,
			`--stream`,
			...services.map((s) => `--scope ${s.name}`),
		].join(' ');

		if (dryRun) {
			console.log(`Exiting due to dry run mode`);
			console.log(`Generated command: ${targetCmd}`);
			return;
		}

		const child = execa.command(
			targetCmd,
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
