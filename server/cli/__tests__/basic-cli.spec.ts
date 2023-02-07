import { afterEach, describe, expect, it } from '@jest/globals';
import * as path from 'path';
import { buildFs, TestCleanup, runCliForTesting } from './test-utils';

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
			'./packages/foo/src/index.ts': 'export const a = 1',
		});
		cleanup.push(targetDir.cleanup);

		const env = {
			PATH: `${process.env.PATH}:${path.resolve(
				process.cwd(),
				'node_modules',
				'.bin',
			)}`,
		};

		// Should work with 'PROJECT_PATH' set
		{
			const result = await runCliForTesting('version', {
				env: {
					...env,
					PROJECT_PATH: targetDir.path,
				} as any,
			});
			expect(result.exitCode).toEqual(0);
		}

		// Should fail without project root
		await expect(
			runCliForTesting('version', {
				env: env as any,
			}),
		).rejects.toThrow(/Could not find sidekick.config.ts/);

		// Should work from project root
		{
			const result = await runCliForTesting('version', {
				env: env as any,
				cwd: targetDir.path,
			});
			expect(result.exitCode).toEqual(0);
		}

		// Should work from project root's sub directory
		{
			const result = await runCliForTesting('version', {
				env: env as any,
				cwd: path.resolve(targetDir.path, 'packages/foo'),
			});
			expect(result.exitCode).toEqual(0);
		}
	}, 10e3);
});
