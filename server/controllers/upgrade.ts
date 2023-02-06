import { z } from 'zod';
import { ConfigManager, ReleaseChannels } from '../services/config';
import { Logger } from '../services/logger';

import { createRpcMethod } from '../utils/http';
import { startTask } from '../utils/TaskRunner';
import { UpgradeUtils } from '../utils/UpgradeUtils';

const logger = new Logger('upgrade');

// Delay the restart long enough that the HTTp response can be sent
const scheduleRestart = async () => {
	const channel = await ConfigManager.getActiveChannel();
	if (channel !== 'dev') {
		setTimeout(() => {
			process.kill(process.ppid, 'SIGHUP');
		}, 200);
	}
};

export const checkForSidekickUpdates = createRpcMethod(
	z.object({
		channel: z.enum(ReleaseChannels).optional(),
	}),
	async ({ channel }) => {
		const config = await ConfigManager.createProvider();
		channel ??= await config.getValue('releaseChannel');

		return {
			channel,
			...(await UpgradeUtils.checkForUpdates(channel)),
		};
	},
);

export const upgradeSidekick = createRpcMethod(
	z.object({
		channel: z.enum(ReleaseChannels).optional(),
		force: z.boolean().optional(),
	}),
	async ({ channel, force }) => {
		const config = await ConfigManager.createProvider();
		channel ??= await config.getValue('releaseChannel');

		const { needsUpgrade, currentVersion, latestVersion } =
			await UpgradeUtils.checkForUpdates(channel);
		logger.info(`Checked for updates`, {
			channel,
			needsUpgrade,
			currentVersion,
			latestVersion,
		});

		if (channel !== 'dev' && channel !== 'stable' && (needsUpgrade || force)) {
			await UpgradeUtils.upgradeChannel(channel);

			// If the channel we're upgrading is the active channel, restart the server
			if ((await ConfigManager.getActiveChannel()) === channel) {
				await scheduleRestart();
			}
		}

		return { currentVersion, latestVersion };
	},
);

export const setSidekickChannel = createRpcMethod(
	z.object({
		channel: z.enum(ReleaseChannels),
	}),
	async ({ channel }) => {
		if (channel === 'dev') {
			throw new Error(`Cannot set channel to "dev"`);
		}

		const isChannelInstalled = await UpgradeUtils.isChannelInstalled(channel);
		if (channel !== 'stable' && !isChannelInstalled) {
			await UpgradeUtils.upgradeChannel(channel);
		}

		const config = await ConfigManager.createProvider();
		await config.setValue('releaseChannel', channel);

		await scheduleRestart();

		return { ok: true };
	},
);

startTask('Auto upgrade', async () => {
	const activeChannel = await ConfigManager.getActiveChannel();
	if (activeChannel === 'dev' || activeChannel === 'stable') {
		return;
	}

	const config = await ConfigManager.createProvider();
	const autoUpgrade = async () => {
		try {
			const enableAutoUpgrades = await config.getValue('enableAutoUpgrades');
			if (!enableAutoUpgrades) {
				return;
			}
			await upgradeSidekick.run({ channel: activeChannel });
		} catch {}
	};

	// Check once on startup
	await autoUpgrade();

	// Check for updates every hour
	setInterval(autoUpgrade, 1000 * 60 * 60);
});
