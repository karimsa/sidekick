import { program } from 'commander';
import './start';

program.parseAsync().catch((error) => {
	console.error(error);
	process.exit(1);
});
