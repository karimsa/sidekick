import { program } from 'commander';
import './start';
import './monitor';

program.parseAsync().catch((error) => {
	console.error(error);
	process.exit(1);
});
