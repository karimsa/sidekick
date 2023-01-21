import * as childProcess from 'child_process';
import * as fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { createCommand } from '../cli/createCommand';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';

export async function setReleaseChannel(
	releaseChannel: 'beta' | 'nightly' | 'stable',
) {
	const config = await ConfigManager.createProvider();

	const isChannelInstalled =
		releaseChannel === 'stable'
			? true
			: await fs.promises
					.stat(
						path.resolve(
							await ConfigManager.getChannelDir(releaseChannel),
							'package.json',
						),
					)
					.then(() => true)
					.catch((err) => {
						if (err.code === 'ENOENT') {
							return false;
						}
						throw err;
					});
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

	childProcess.execSync(
		`${process.argv[0]} ${path.resolve(__dirname, 'cli.dist.js')} version`,
		{
			stdio: 'inherit',
		},
	);
}

createCommand({
	name: 'set-channel',
	description: 'Changes the active sidekick channel',
	options: z.object({
		channel: z
			.enum(['stable', 'beta', 'nightly'])
			.describe('Release channel to upgrade into'),
	}),
	async action({ channel: releaseChannel }) {
		await setReleaseChannel(releaseChannel);
	},
});
