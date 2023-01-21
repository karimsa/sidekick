import axios from 'axios';
import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { version as sidekickVersion } from '../../package.json';
import { createCommand } from '../cli/createCommand';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import { UpgradeUtils } from '../utils/update-utils';
import { setReleaseChannel } from './set-channel';

const RC_BRANCHES = {
	nightly: 'develop',
	beta: 'main',
} as const;

async function getLatestVersion(channel: 'beta' | 'nightly') {
	const { data } = await axios.get(
		`https://api.github.com/repos/karimsa/sidekick/git/ref/heads/${RC_BRANCHES[channel]}`,
	);
	const result = z
		.object({ object: z.object({ sha: z.string() }) })
		.safeParse(data);
	if (!result.success) {
		throw new Error(`Failed to get latest commit from github`);
	}
	return result.data.object.sha;
}

async function upgradeSidekick(channel: 'beta' | 'nightly') {
	const channelDir = await ConfigManager.getChannelDir(channel);
	const isInstalled = await fs.promises
		.stat(path.resolve(channelDir, 'package.json'))
		.then(() => true)
		.catch((err) => {
			if (err.code === 'ENOENT') {
				return false;
			}
			throw err;
		});
	if (!isInstalled) {
		console.log(fmt`Installing ${channel} channel ...`);
		await fs.promises.mkdir(channelDir, {
			recursive: true,
		});
		await execa.command(
			`git clone -b ${RC_BRANCHES[channel]} https://github.com/karimsa/sidekick.git .`,
			{
				cwd: channelDir,
			},
		);
	}

	console.log(fmt`Upgrading ${channel} channel ...`);
	await execa.command(
		`${path.resolve(__dirname, 'perform-upgrade.sh')} ${RC_BRANCHES[channel]}`,
		{
			cwd: channelDir,
		},
	);
	await execa.command(`yarn`, {
		cwd: channelDir,
	});

	console.log(`Building ${channel} release ...`);
	await execa.command(`yarn build`, {
		cwd: channelDir,
	});

	await fs.promises.writeFile(
		path.resolve(channelDir, 'sidekick.build.json'),
		JSON.stringify({
			sidekickVersion,
			nodeVersion: process.version,
			arch: process.arch,
		}),
	);
}

createCommand({
	name: 'install',
	description: 'Install or update a sidekick release channel',
	options: z.object({
		channel: z
			.enum(['beta', 'nightly'])
			.describe('Release channel to upgrade into'),
		activate: z
			.boolean()
			.default(false)
			.describe('After upgrading, activate this channel as the new channel'),
		force: z
			.boolean()
			.default(false)
			.describe(
				'Try to force upgrade sidekick, even if no upgrades are available',
			),
		dryRun: z
			.boolean()
			.optional()
			.describe(
				'If true, will check for upgrade without performing an upgrade',
			),
	}),
	async action({ channel: releaseChannel, activate, force, dryRun }) {
		const config = await ConfigManager.createProvider();

		// Store the upgrade channel
		if ((await config.getValue('releaseChannel')) !== releaseChannel) {
			console.log(fmt`Switching release channel to ${releaseChannel}`);
			await config.setValue('releaseChannel', releaseChannel);
		}

		const [currentVersion, latestVersion] = await Promise.all([
			UpgradeUtils.getChannelVersion(releaseChannel),
			getLatestVersion(releaseChannel),
		]);
		if (currentVersion === latestVersion) {
			console.log(
				fmt`Sidekick is up-to-date: ${{
					channel: releaseChannel,
					version: currentVersion,
				}}`,
			);

			// Default behaviour is to exit if no updates are needed
			if (!force) {
				if (activate) {
					await setReleaseChannel(releaseChannel);
				}

				return;
			}
		} else {
			console.log(
				fmt`Sidekick needs to be updated: ${{
					channel: releaseChannel,
					currentVersion,
					latestVersion,
				}}`,
			);
		}

		// Exit early in dry runs
		if (dryRun) {
			return;
		}

		// Perform the upgrade
		await upgradeSidekick(releaseChannel);

		console.log(
			fmt`Sidekick upgraded: ${{
				releaseChannel,
				previousVersion: currentVersion,
				updatedVersion: await UpgradeUtils.getChannelVersion(releaseChannel),
			}}`,
		);

		if (activate) {
			await setReleaseChannel(releaseChannel);
		}
	},
});
