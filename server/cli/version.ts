import { program } from 'commander';
import { fmt } from '../../utils/fmt';
import { version } from '../../package.json';

program
	.command('version')
	.description('Print version info')
	.action(async () => {
		console.log(
			fmt`${{
				sidekick: version,
				node: process.version,
			}}`,
		);
	});
