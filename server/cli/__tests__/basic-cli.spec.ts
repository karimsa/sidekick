import { afterEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildFs, runCliForTesting } from './test-utils';

describe('sidekick version', () => {
	const cleanup: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const fn of cleanup) {
			await fn();
		}
		cleanup.splice(0, cleanup.length);
	});

	it('should not crash', async () => {
		const targetDir = await buildFs({
			'./sidekick.config.ts': 'export const config = {}',
			'./package.json': JSON.stringify({
				private: true,
				name: 'test',
				version: '1.0.0',
				workspaces: ['./packages/*'],
			}),
		});
		cleanup.push(targetDir.cleanup);

		const env = {
			PROJECT_PATH: targetDir.path,
			PATH: `${process.env.PATH}:${path.resolve(
				process.cwd(),
				'node_modules',
				'.bin',
			)}`,
		};

		const result = await runCliForTesting('yarn cli version', env);
		expect(result.exitCode).toEqual(0);
	}, 10e3);
});
