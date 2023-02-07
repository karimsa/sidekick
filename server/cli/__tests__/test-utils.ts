import * as tmp from 'tmp-promise';
import fs from 'fs';
import path from 'path';
import execa from 'execa';
import stripAnsi from 'strip-ansi';

type CleanupHook = () => Promise<void> | undefined | void;
export class TestCleanup {
	cleanup: CleanupHook[] = [];
	readonly push = (hook: CleanupHook) => this.cleanup.push(hook);
	readonly afterEachHook = async () => {
		for (const fn of this.cleanup) {
			await fn();
		}
		this.cleanup.splice(0, this.cleanup.length);
	};
}

export async function buildFs(files: Record<string, string | null>) {
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

	await fs.promises.mkdir(path.resolve(targetDir, './node_modules/@karimsa'), {
		recursive: true,
	});
	await fs.promises.symlink(
		path.resolve(__dirname, '../../../'),
		path.resolve(targetDir, './node_modules/@karimsa/sidekick'),
		'dir',
	);

	return {
		path: targetDir,
		cleanup: async () => fs.promises.rm(targetDir, { recursive: true }),
	};
}

const node = process.argv[0];
const bootstrap = path.resolve(
	__dirname,
	'../../../sidekick-bootstrap.dist.js',
);

export async function runCliForTesting(
	command: string,
	options?: Omit<execa.Options, 'env'> & {
		env?: Record<string, string>;
	},
) {
	const { stdout, stderr, ...res } = await execa.command(
		`${node} ${bootstrap} ${command}`,
		{
			...options,
			env: options?.env as any,
		},
	);
	return {
		...res,
		stdout: stripAnsi(stdout),
		stderr: stripAnsi(stderr),
	};
}
