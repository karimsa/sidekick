import './';

import { ConfigManager } from '../services/config';
import { ensureProjectDir } from '../utils/findProjectDir';
import { runCliWithArgs } from './createCommand';

setImmediate(async () => {
	ensureProjectDir();

	if (process.env.NODE_ENV === 'production') {
		const config = await ConfigManager.createProvider();
		const releaseChannel = await config.getValue('releaseChannel');
		const activeChannel = await ConfigManager.getActiveChannel();

		if (activeChannel !== releaseChannel) {
			console.warn(
				`WARN: Sidekick is running as ${activeChannel}, but configured as ${releaseChannel} (upgrade failed)`,
			);
		}
	}

	const code = await runCliWithArgs(process.argv.slice(2));
	process.exit(code);
});
