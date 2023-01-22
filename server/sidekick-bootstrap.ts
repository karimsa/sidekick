import * as childProcess from 'child_process';
import * as fs from 'fs';

import { ConfigManager } from './services/config';
import { ensureProjectDir } from './utils/findProjectDir';
import { UpgradeUtils } from './utils/UpgradeUtils';

async function main() {
	ensureProjectDir();

	let targetReleaseChannel = await ConfigManager.getConfiguredReleaseChannel();
	let targetDir = await ConfigManager.getChannelDir(targetReleaseChannel);

	if (!fs.existsSync(targetDir)) {
		console.warn(
			`WARN: Sidekick is configured to run as ${targetReleaseChannel}, but it is not installed.`,
		);
		console.warn(`Automatically switching to stable channel\n`);

		const config = await ConfigManager.createProvider();
		await config.setValue('releaseChannel', 'stable');

		targetReleaseChannel = 'stable';
		targetDir = await ConfigManager.getChannelDir(targetReleaseChannel);
	}

	if (process.env.DEBUG?.includes('sidekick')) {
		console.log(`Starting sidekick: %O`, {
			releaseChannel: targetReleaseChannel,
			location: targetDir,
		});
	}

	if (targetReleaseChannel !== 'stable') {
		const buildInfo = await UpgradeUtils.getBuildInfo(targetReleaseChannel);
		if (
			buildInfo.nodeMajorVersion !== Number(process.version.split(/[v.]/)[1])
		) {
			throw new Error(
				`Sidekick ${targetReleaseChannel} was installed with Node.js ${buildInfo.nodeVersion}. It cannot be run with Node.js ${process.version}.`,
			);
		}
		if (buildInfo.arch !== process.arch) {
			throw new Error(
				`Sidekick ${targetReleaseChannel} was installed for ${buildInfo.arch}. It cannot be run on ${process.arch}.`,
			);
		}
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
