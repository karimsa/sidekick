import * as childProcess from 'child_process';

import { ConfigManager } from './services/config';
import { ensureProjectDir } from './utils/findProjectDir';

async function main() {
	ensureProjectDir();

	const config = await ConfigManager.createProvider();
	const targetReleaseChannel = await config.getValue('releaseChannel');
	const targetDir = await ConfigManager.getChannelDir(targetReleaseChannel);

	if (process.env.DEBUG?.includes('sidekick')) {
		console.log(`Starting sidekick: %O`, {
			releaseChannel: targetReleaseChannel,
			location: targetDir,
		});
	}

	try {
		childProcess.execFileSync(
			process.argv[0],
			[`${targetDir}/cli.dist.js`, ...process.argv.slice(2)],
			{
				stdio: 'inherit',
			},
		);
	} catch (err: unknown) {
		const status = (err as { status?: number }).status;
		if (typeof status === 'number') {
			console.log(`Exited with status ${status}`);
			process.exit(status);
		}
		throw err;
	}
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
