import execa from 'execa';
import * as fs from 'fs';
import { once } from 'events';

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
			bootstrapPid: process.pid,
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

	const runUpgradedProcess = async () => {
		try {
			const child = execa.node(
				`${targetDir}/cli.dist.js`,
				process.argv.slice(2),
				{
					stdio: 'inherit',
					env: {
						SIDEKICK_DID_BOOTSTRAP: 'true',
					} as any,
				},
			);
			if (process.env.DEBUG?.includes('sidekick')) {
				console.log(`Sidekick CLI started as pid ${child.pid}`);
			}

			const exitType = await Promise.race([
				child.then(() => 'EXIT' as const),
				once(process, 'SIGHUP').then(() => 'SIGHUP' as const),
				once(process, 'SIGTERM').then(() => 'SIGTERM' as const),
			]);
			if (exitType === 'SIGHUP') {
				console.log(`Received SIGHUP, attempting to restart Sidekick`);
			} else {
				console.log(`Received SIGTERM, exiting Sidekick`);
			}
			if (exitType !== 'EXIT') {
				await child.kill('SIGTERM');
			}
			return exitType;
		} catch (err: unknown) {
			const status = (err as { status?: number }).status;
			if (typeof status === 'number') {
				console.log(`Exited with status ${status}`);
				process.exit(status);
			}
			throw err;
		}
	};

	while (true) {
		const exitType = await runUpgradedProcess();
		if (exitType !== 'SIGHUP') {
			break;
		}
		console.log('-'.repeat(15));
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
