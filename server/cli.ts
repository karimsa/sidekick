import { program } from 'commander';
import * as path from 'path';
import execa from 'execa';

program
	.command('start')
	.description('Start sidekick for a specific project')
	.option(
		'-d, --directory [directory]',
		'Path to your yarn/lerna workspace (default: current directory)',
	)
	.option(
		'-p, --port [port]',
		'Port to run sidekick on (default: 9002)',
		(arg) => parseInt(arg, 10),
	)
	.action(
		async ({
			project,
			port,
		}: {
			project?: string;
			unstable?: boolean;
			port?: number;
		}) => {
			project =
				project?.[0] === '~'
					? path.join(process.env.HOME!, project.substring(1))
					: project;
			const projectDir = path.resolve(process.cwd(), project ?? '.');
			console.log(`Starting sidekick in: ${projectDir}`);

			await execa.command('');
		},
	);

program.parseAsync().catch((error) => {
	console.error(error);
	process.exit(1);
});
