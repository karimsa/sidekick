import execa from 'execa';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { z } from 'zod';
import { testHttp } from '../utils/healthcheck';
import { createCommand } from './createCommand';

createCommand({
	name: 'start',
	description: 'Start sidekick for a specific project',
	options: z.object({
		port: z.number().default(9010).describe('Port to run sidekick on'),
		bindAddr: z
			.string()
			.min(1, 'Must be at least 1 character')
			.default('::1')
			.describe('Address to bind the sidekick server to'),
	}),
	async action({ port = 9010, projectDir, bindAddr }) {
		if (!bindAddr) {
			throw new Error(`--bind-addr must be specified`);
		}

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
					SIDEKICK_BIND_ADDR: bindAddr,
				},
			},
		);

		child.stdout!.pipe(logStream);
		child.stderr!.on('data', (chunk) => {
			logStream.write(chunk);
			process.stderr.write(chunk);
		});

		process.stdout.write(`Waiting for sidekick to start ...\r`);
		const sidekickHost = net.isIPv6(bindAddr) ? `[::1]` : '127.0.0.1';

		// eslint-disable-next-line no-empty
		while (
			!(await testHttp({
				method: 'GET',
				url: `http://${sidekickHost}:${port}`,
			}))
		) {}
		console.log(`Sidekick started on http://${sidekickHost}:${port}`);

		await child;
	},
});
