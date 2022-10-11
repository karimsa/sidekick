import { fmt } from '../utils/fmt';
import packageJson from '../../package.json';
import { createCommand } from './createCommand';
import { z } from 'zod';
import { ConfigManager } from '../services/config';
import { getCurrentVersion } from './upgrade';

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
							: await getCurrentVersion(releaseChannel)
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
