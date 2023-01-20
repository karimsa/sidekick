import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { testHttp } from '../utils/healthcheck';
import { createCommand } from './createCommand';

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
					SIDEKICK: 'true',
					NODE_ENV: 'production',
					PROJECT_PATH: projectDir,
					SIDEKICK_PORT: String(port),
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
		while (
			!(await testHttp({ method: 'GET', url: `http://localhost:${port}` }))
		) {}
		console.log(`Sidekick started on http://localhost:${port}`);

		await child;
	},
});
