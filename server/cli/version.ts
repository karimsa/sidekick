import { z } from 'zod';

import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import { UpgradeUtils } from '../utils/UpgradeUtils';
import { createCommand } from './createCommand';

export async function getSidekickVersion() {
	const releaseChannel = await ConfigManager.getActiveChannel();

	return {
		version: await UpgradeUtils.getChannelVersion(releaseChannel),
		mode: process.env.NODE_ENV || 'development',
		releaseChannel,
		node: process.version,
	};
}

createCommand({
	name: 'version',
	description: 'Print version info',
	options: z.object({}),
	async action() {
		console.log(fmt`${await getSidekickVersion()}`);
	},
});
