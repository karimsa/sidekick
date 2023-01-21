import * as fs from 'fs';
import { z } from 'zod';

import { createCommand } from '../cli/createCommand';
import { ConfigManager } from '../services/config';

createCommand({
	name: 'remove',
	description: 'Removes a sidekick channel installation from your system',
	options: z.object({
		channel: z
			.enum(['beta', 'nightly'])
			.describe('The channel to remove (beta or nightly)'),
	}),
	action: async ({ channel }) => {
		const config = await ConfigManager.createProvider();
		if ((await config.getValue('releaseChannel')) === channel) {
			console.log(
				`${channel} is currently the active channel for ${config.projectName}`,
			);
			console.log(`Switching to stable ...`);
			await config.setValue('releaseChannel', 'stable');
		}

		const channelDir = await ConfigManager.getChannelDir(channel);
		console.log(`Removing: ${channelDir}`);
		await fs.promises.rm(channelDir, {
			force: true,
			recursive: true,
		});
	},
});
