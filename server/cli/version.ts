import { z } from 'zod';

import packageJson from '../../package.json';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import { UpgradeUtils } from '../utils/update-utils';
import { createCommand } from './createCommand';

const { version } = packageJson;

export async function getSidekickVersion() {
	const releaseChannel = await ConfigManager.getActiveChannel();

	return {
		version:
			releaseChannel === 'stable'
				? version
				: `${version}-${
						releaseChannel === 'dev'
							? 'dev'
							: await UpgradeUtils.getChannelVersion(releaseChannel)
				  }`,
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
