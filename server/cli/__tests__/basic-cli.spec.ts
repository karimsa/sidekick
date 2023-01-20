import { afterEach, describe, expect, it } from '@jest/globals';
import * as path from 'path';
import { buildFs, runCliForTesting, TestCleanup } from './test-utils';

describe('sidekick version', () => {
	const cleanup = new TestCleanup();
	afterEach(cleanup.afterEachHook);

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
