import { program } from 'commander';
import * as path from 'path';
import execa from 'execa';
import * as crypto from 'crypto';

import { NvmUtil } from '../../app/utils/nvm.util';

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
	.option('--unstable', 'Use the unstable release of sidekick')
	.action(
		async ({
			project,
			unstable,
			port,
		}: {
			project?: string;
			unstable?: boolean;
			port?: number;
		}) => {
			// TODO: Work without nvm
			if (!(await NvmUtil.checkNvmInstalled())) {
				throw new Error(
					`nvm was not found installed on your system, and sidekick cannot operate without it`,
				);
			}

			const [isDockerInstalled, isDockerConnected] = await Promise.all([
				execa
					.command('which docker')
					.then(() => true)
					.catch(() => false),
				execa
					.command('docker version')
					.then(() => true)
					.catch(() => false),
			]);
			if (!isDockerInstalled) {
				throw new Error(
					`Could not find a docker client installed on your machine`,
				);
			}
			if (!isDockerConnected) {
				throw new Error(`Docker daemon is not connected`);
			}

			project =
				project?.[0] === '~'
					? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					  path.join(process.env.HOME!, project.substring(1))
					: project;
			const projectDir = path.resolve(process.cwd(), project ?? '.');
			console.log(`Starting sidekick in: ${projectDir}`);

			const containerName = `sidekick-${crypto.randomBytes(2).toString('hex')}`;
			const image = `ghcr.io/karimsa/sidekick:${
				unstable ? 'unstable' : 'latest'
			}`;
			const containerPort = isNaN(port ?? NaN) ? 9002 : port;

			await execa.command(
				`docker run --name ${containerName} --restart=on-failure -v "$HOME/.sidekick:/config" -v "${projectDir}:/project" -p 9002:${containerPort} ${image}`,
				{
					stdin: 'inherit',
					stderr: 'inherit',
					stdout: 'ignore',
				},
			);
		},
	);

program.parseAsync().catch((error) => {
	console.error(error);
	process.exit(1);
});
