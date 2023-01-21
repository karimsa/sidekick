import './install';
import './list';
import './remove';
import './set-channel';

import { runCliWithArgs } from '../cli/createCommand';
import { ensureProjectDir } from '../utils/findProjectDir';

setImmediate(async () => {
	ensureProjectDir();
	const code = await runCliWithArgs(process.argv.slice(2));
	process.exit(code);
});
