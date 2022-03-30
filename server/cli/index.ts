import { program } from 'commander';
import './start';
import './monitor';
import './version';

program.parseAsync().catch((error) => {
	console.error(error);
	process.exit(1);
});
