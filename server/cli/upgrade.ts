import { createCommand } from './createCommand';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import execa from 'execa';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import { fileExists } from '../utils/fileExists';

const RC_BRANCHES = {
	nightly: 'develop',
	beta: 'main',
} as const;

export async function getCurrentVersion(channel: 'beta' | 'nightly') {
	if (
		await fileExists(
			path.resolve(await ConfigManager.getChannelDir(channel), 'package.json'),
		)
	) {
		const { stdout } = await execa.command(`git log -n1 --pretty=%H`, {
			cwd: await ConfigManager.getChannelDir(channel),
		});
		return stdout.trim();
	}
	return null;
}

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
	const isBetaInstalled = await fileExists(
		path.resolve(channelDir, 'package.json'),
	);
	if (!isBetaInstalled) {
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
	await execa.command(`git pull origin ${RC_BRANCHES[channel]}`, {
		cwd: channelDir,
	});
	await execa.command(`yarn`, {
		cwd: channelDir,
	});

	console.log(`Building ${channel} release ...`);
	await execa.command(`yarn build`, {
		cwd: channelDir,
	});
}

createCommand({
	name: 'upgrade',
	description: 'Looks to see if any updates are available for sidekick',
	options: z.object({
		channel: z
			.enum(['beta', 'nightly'])
			.describe('Release channel to upgrade into'),
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
	async action({ channel: releaseChannel, force, dryRun }) {
		const config = await ConfigManager.createProvider();

		// Store the upgrade channel
		if ((await config.getValue('releaseChannel')) !== releaseChannel) {
			console.log(fmt`Switching release channel to ${releaseChannel}`);
			await config.setValue('releaseChannel', releaseChannel);
		}

		const [currentVersion, latestVersion] = await Promise.all([
			getCurrentVersion(releaseChannel),
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
				updatedVersion: await getCurrentVersion(releaseChannel),
			}}`,
		);
	},
});
