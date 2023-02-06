import { z } from 'zod';

import { createCommand } from '../cli/createCommand';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import { UpgradeUtils } from '../utils/UpgradeUtils';
import { setReleaseChannel } from './set-channel';

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

		const { needsUpgrade, currentVersion, latestVersion } =
			await UpgradeUtils.checkForUpdates(releaseChannel);
		if (!needsUpgrade) {
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
		await UpgradeUtils.upgradeChannel(releaseChannel);

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
