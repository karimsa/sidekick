import * as path from 'path';
import * as fs from 'fs';
import execa from 'execa';
import { testHttp } from '../../utils/healthcheck';
import { createCommand } from './createCommand';
import { z } from 'zod';

createCommand({
	name: 'start',
	description: 'Start sidekick for a specific project',
	options: z.object({
		port: z.number().default(9010).describe('Port to run sidekick on'),
	}),
	async action({ port = 9010, projectDir }) {
		await fs.promises.mkdir(`${process.env.HOME}/.sidekick`, {
			recursive: true,
		});

		const logStream = fs.createWriteStream(
			path.resolve(process.env.HOME!, '.sidekick', 'server.log'),
		);
		const child = execa.command(
			`node ${path.resolve(__dirname, 'server.dist.js')}`,
			{
				stdin: 'ignore',
				env: {
					...process.env,
					DEBUG: 'sidekick:*',
					NODE_ENV: 'production',
					PROJECT_PATH: projectDir,
					PORT: String(port),
				},
			},
		);

		child.stdout!.pipe(logStream);
		child.stderr!.on('data', (chunk) => {
			logStream.write(chunk);
			process.stderr.write(chunk);
		});

		process.stdout.write(`Waiting for sidekick to start ...\r`);
		// eslint-disable-next-line no-empty
		while (!(await testHttp(port))) {}
		console.log(`Sidekick started on http://localhost:${port}`);

		await child;
	},
});
