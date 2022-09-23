import { fmt } from '../utils/fmt';
import { version } from '../../package.json';
import { createCommand } from './createCommand';
import { z } from 'zod';
import { ConfigManager } from '../services/config';
import { getCurrentVersion } from './upgrade';

export async function getSidekickVersion() {
	const releaseChannel = await ConfigManager.getActiveChannel();

	return {
		version:
			releaseChannel === 'stable'
				? version
				: `${version}-${await getCurrentVersion(releaseChannel)}`,
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
