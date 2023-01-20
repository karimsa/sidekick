import { afterEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildFs, runCliForTesting, TestCleanup } from './test-utils';

describe('sidekick prepare', () => {
	const cleanup = new TestCleanup();
	afterEach(cleanup.afterEachHook);

	it('should be able to identify stale files and prepare them from the cli', async () => {
		const targetDir = await buildFs({
			'./lerna.json': JSON.stringify({
				version: '0.0.0',
				packages: ['./packages/*'],
			}),
			'./sidekick.config.ts': 'export const config = {}',
			'./package.json': JSON.stringify({
				private: true,
				name: 'test',
				version: '1.0.0',
				workspaces: ['./packages/*'],
			}),
			'./packages/foo/src/index.ts': 'export const a = 1',
			'./packages/foo/.sidekick.json': '{}',
			'./packages/foo/package.json': JSON.stringify({
				name: 'foo',
				version: '0.0.0',
				scripts: { prepare: 'echo done > did-prepare && echo output from foo' },
			}),
			'./packages/bar/src/index.ts': 'export const b = 1',
			'./packages/bar/src/.sidekick.json': '{}',
			'./packages/bar/package.json': JSON.stringify({
				name: 'bar',
				version: '0.0.0',
				scripts: { prepare: 'echo done > did-prepare && echo output from bar' },
			}),
		});
		cleanup.push(targetDir.cleanup);

		const resetPreparedState = async () => {
			try {
				await fs.promises.unlink(
					path.resolve(targetDir.path, './packages/foo/did-prepare'),
				);
			} catch (err: any) {
				if (err.code !== 'ENOENT') {
					throw err;
				}
			}
			try {
				await fs.promises.unlink(
					path.resolve(targetDir.path, './packages/bar/did-prepare'),
				);
			} catch (err: any) {
				if (err.code !== 'ENOENT') {
					throw err;
				}
			}
		};

		const env = {
			PROJECT_PATH: targetDir.path,
			PATH: `${process.env.PATH}:${path.resolve(
				process.cwd(),
				'node_modules',
				'.bin',
			)}`,
		};

		// Verify dry run for first run
		{
			const result = await runCliForTesting('yarn cli prepare --dryRun', env);
			expect(result.exitCode).toEqual(0);

			expect(result.stdout).toMatch(/foo/);
			expect(result.stdout).toMatch(/bar/);
		}

		// Verify real run for first run
		{
			const result = await runCliForTesting('yarn cli prepare', env);
			expect(result.exitCode).toEqual(0);

			const logs = result.stdout;
			expect(logs).toMatch(/output from foo/);
			expect(logs).toMatch(/output from bar/);
			expect(
				await fs.promises.readFile(
					path.resolve(targetDir.path, './packages/foo/did-prepare'),
					'utf8',
				),
			).toEqual('done\n');
			expect(
				await fs.promises.readFile(
					path.resolve(targetDir.path, './packages/bar/did-prepare'),
					'utf8',
				),
			).toEqual('done\n');
		}

		//
		// Creating new files
		//

		// Update a single package - create a new file
		await fs.promises.writeFile(
			path.resolve(targetDir.path, './packages/bar/src/foo.ts'),
			'export const c = Math.PI',
		);
		await resetPreparedState();

		// Verify dry run for new file
		{
			const result = await runCliForTesting('yarn cli prepare --dryRun', env);
			expect(result.exitCode).toEqual(0);

			expect(result.stdout).not.toMatch(/foo/);
			expect(result.stdout).toMatch(/bar/);
		}

		// Verify real run for new file
		{
			const result = await runCliForTesting('yarn cli prepare', env);
			expect(result.exitCode).toEqual(0);

			expect(result.stdout).not.toMatch(/output from foo/);
			expect(result.stdout).toMatch(/output from bar/);
			await expect(
				fs.promises.readFile(
					path.resolve(targetDir.path, './packages/foo/did-prepare'),
					'utf8',
				),
			).rejects.toThrow(/ENOENT/);
			expect(
				await fs.promises.readFile(
					path.resolve(targetDir.path, './packages/bar/did-prepare'),
					'utf8',
				),
			).toEqual('done\n');
		}

		//
		// Updating existing files
		//

		// Update an existing file in foo
		await fs.promises.writeFile(
			path.resolve(targetDir.path, './packages/foo/src/index.ts'),
			'export const c = Math.PI',
		);
		await resetPreparedState();

		// Verify dry run for new file
		{
			const result = await runCliForTesting('yarn cli prepare --dryRun', env);
			expect(result.exitCode).toEqual(0);

			expect(result.stdout).toMatch(/foo/);
			expect(result.stdout).not.toMatch(/bar/);
		}

		// Verify real run for new file
		{
			const result = await runCliForTesting('yarn cli prepare', env);
			expect(result.exitCode).toEqual(0);

			expect(result.stdout).toMatch(/output from foo/);
			expect(result.stdout).not.toMatch(/output from bar/);
			expect(
				await fs.promises.readFile(
					path.resolve(targetDir.path, './packages/foo/did-prepare'),
					'utf8',
				),
			).toEqual('done\n');
			await expect(
				fs.promises.readFile(
					path.resolve(targetDir.path, './packages/bar/did-prepare'),
					'utf8',
				),
			).rejects.toThrow(/ENOENT/);
		}
	}, 10e3);
});
