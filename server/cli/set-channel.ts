import { createCommand } from './createCommand';
import { z } from 'zod';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import * as fs from 'fs';
import path from 'path';
import { getSidekickVersion } from './version';
import { fileExists } from '../utils/fileExists';

createCommand({
	name: 'set-channel',
	description: 'Changes the active sidekick channel',
	options: z.object({
		channel: z
			.enum(['stable', 'beta', 'nightly'])
			.describe('Release channel to upgrade into'),
	}),
	async action({ channel: releaseChannel }) {
		const config = await ConfigManager.createProvider();

		const isChannelInstalled =
			releaseChannel === 'stable'
				? true
				: await fileExists(
						path.resolve(
							await ConfigManager.getChannelDir(releaseChannel),
							'package.json',
						),
				  );
		if (!isChannelInstalled) {
			throw new Error(
				`Channel ${releaseChannel} is not installed (use \`yarn sidekick upgrade --channel=${releaseChannel}\` to install it`,
			);
		}

		// Store the upgrade channel
		if ((await config.getValue('releaseChannel')) !== releaseChannel) {
			console.log(fmt`Switching release channel to ${releaseChannel}`);
			await config.setValue('releaseChannel', releaseChannel);
		} else {
			console.log(fmt`Release channel is already ${releaseChannel}`);
		}

		const sidekickBetaCliPath = ConfigManager.getSidekickBetaCli();
		try {
			await fs.promises.unlink(sidekickBetaCliPath);
		} catch (err: any) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}

		// For beta/nightly, setup the global symlink
		if (releaseChannel !== 'stable') {
			await fs.promises.symlink(
				path.resolve(
					await ConfigManager.getChannelDir(releaseChannel),
					'cli.dist.js',
				),
				sidekickBetaCliPath,
			);
			await fs.promises.chmod(sidekickBetaCliPath, 0o755);
		}

		console.log(fmt`${await getSidekickVersion()}`);
	},
});
