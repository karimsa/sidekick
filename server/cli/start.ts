import { program } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import execa from 'execa';
import { testHttp } from '../../utils/healthcheck';

program
	.command('start')
	.description('Start sidekick for a specific project')
	.option(
		'-d, --directory [directory]',
		'Path to your yarn/lerna workspace (default: current directory)',
	)
	.option(
		'-p, --port [port]',
		'Port to run sidekick on (default: 9010)',
		(arg) => parseInt(arg, 10),
	)
	.action(
		async ({
			project,
			port = 9010,
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

			await fs.promises.mkdir(`${process.env.HOME}/.sidekick`, {
				recursive: true,
			});

			const logStream = fs.createWriteStream(
				path.resolve(process.env.HOME!, '.sidekick', 'server.log'),
			);
			const child = execa.command(
				`node ${path.resolve(__dirname, 'server.dist.js')}`,
				{
					stdin: 'ignore',
					env: {
						...process.env,
						DEBUG: 'sidekick:*',
						NODE_ENV: 'production',
						PROJECT_PATH: projectDir,
						PORT: String(port),
					},
				},
			);

			child.stdout!.pipe(logStream);
			child.stderr!.on('data', (chunk) => {
				logStream.write(chunk);
				process.stderr.write(chunk);
			});

			process.stdout.write(`Waiting for sidekick to start ...\r`);
			// eslint-disable-next-line no-empty
			while (!(await testHttp(port))) {}
			console.log(`Sidekick started on http://localhost:${port}`);

			await child;
		},
	);
