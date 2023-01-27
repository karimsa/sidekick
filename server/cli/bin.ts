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

	// CLI cannot handle restarting itself, but if it is running via bootstrap
	// (which it always should be), it can request that bootstrap handle the restart
	if (process.env.SIDEKICK_DID_BOOTSTRAP === 'true') {
		process.on('SIGHUP', () => {
			process.kill(process.ppid, 'SIGHUP');
		});
	}

	const code = await runCliWithArgs(process.argv.slice(2));
	process.exit(code);
});
