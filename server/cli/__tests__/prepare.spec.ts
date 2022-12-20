import { afterEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as tmp from 'tmp-promise';
import stripAnsi from 'strip-ansi';
// load cli commands
import '../';
import { runCliWithArgs } from '../createCommand';

async function buildFs(files: Record<string, string | null>) {
	const { path: targetDir } = await tmp.dir();

	for (const [filename, content] of Object.entries(files)) {
		if (content) {
			await fs.promises.mkdir(path.resolve(targetDir, path.dirname(filename)), {
				recursive: true,
			});
			await fs.promises.writeFile(path.resolve(targetDir, filename), content);
		} else {
			await fs.promises.mkdir(path.resolve(targetDir, filename), {
				recursive: true,
			});
		}
	}

	return {
		path: targetDir,
		cleanup: async () => fs.promises.rmdir(targetDir, { recursive: true }),
	};
}

async function captureStdout(fn: () => Promise<void>) {
	const write = process.stdout.write;
	const capturedLogs: string[] = [];

	process.stdout.write = (chunk: Buffer | string) => {
		capturedLogs.push(stripAnsi(chunk.toString('utf8')));
		return true;
	};

	try {
		await fn();
	} catch (err) {
		process.stdout.write = write;
		console.dir({ output: capturedLogs });
		throw err;
	}

	process.stdout.write = write;
	return capturedLogs;
}

describe('sidekick prepare', () => {
	const cleanup: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const fn of cleanup) {
			await fn();
		}
		cleanup.splice(0, cleanup.length);
	});

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

		process.env.PROJECT_PATH = targetDir.path;
		process.env.PATH = `${process.env.PATH}:${path.resolve(
			process.cwd(),
			'node_modules',
			'.bin',
		)}`;

		// Verify dry run for first run
		{
			const logs = await captureStdout(async () => {
				expect(await runCliWithArgs(['prepare', '--dryRun'])).toEqual(0);
			});
			expect(logs.join('\n')).toMatch(/foo/);
			expect(logs.join('\n')).toMatch(/bar/);
		}

		// Verify real run for first run
		{
			const logs = await captureStdout(async () => {
				expect(await runCliWithArgs(['prepare'])).toEqual(0);
			});
			expect(logs.join('\n')).toMatch(/output from foo/);
			expect(logs.join('\n')).toMatch(/output from bar/);
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
			const logs = await captureStdout(async () => {
				expect(await runCliWithArgs(['prepare', '--dryRun'])).toEqual(0);
			});
			expect(logs.join('\n')).not.toMatch(/foo/);
			expect(logs.join('\n')).toMatch(/bar/);
		}

		// Verify real run for new file
		{
			const logs = await captureStdout(async () => {
				expect(await runCliWithArgs(['prepare'])).toEqual(0);
			});
			expect(logs.join('\n')).not.toMatch(/output from foo/);
			expect(logs.join('\n')).toMatch(/output from bar/);
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
			const logs = await captureStdout(async () => {
				expect(await runCliWithArgs(['prepare', '--dryRun'])).toEqual(0);
			});
			expect(logs.join('\n')).toMatch(/foo/);
			expect(logs.join('\n')).not.toMatch(/bar/);
		}

		// Verify real run for new file
		{
			const logs = await captureStdout(async () => {
				expect(await runCliWithArgs(['prepare'])).toEqual(0);
			});
			expect(logs.join('\n')).toMatch(/output from foo/);
			expect(logs.join('\n')).not.toMatch(/output from bar/);
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
