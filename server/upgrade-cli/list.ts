import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { createCommand } from '../cli/createCommand';
import { ConfigManager, isReleaseChannel } from '../services/config';
import { UpgradeUtils } from '../utils/UpgradeUtils';

createCommand({
	name: 'list',
	description: 'List all installed versions',
	options: z.object({}),
	action: async () => {
		const channelsDir = path.resolve(
			await ConfigManager.getSidekickPath(),
			'channels',
		);

		if (!fs.existsSync(channelsDir)) {
			console.log(`No versions installed`);
			return;
		}

		const installedChannelDirs = await fs.promises.readdir(channelsDir);
		if (installedChannelDirs.length === 0) {
			console.log(`No versions installed`);
			return;
		}

		console.log('');
		for (const channel of installedChannelDirs) {
			if (isReleaseChannel(channel)) {
				try {
					const buildInfo = await UpgradeUtils.getBuildInfo(channel);
					console.log(
						`\t${channel}\t\tInstalled with node ${buildInfo.nodeVersion} for ${buildInfo.arch}`,
					);
				} catch (err) {
					console.log(
						`\t${channel}\t\t${String((err as Error).message ?? err)}`,
					);
				}
			} else {
				console.log(`\t${channel}\t\t(unknown)`);
			}
		}
		console.log('');
	},
});
