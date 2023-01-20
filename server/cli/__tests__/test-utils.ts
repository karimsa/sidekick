import * as tmp from 'tmp-promise';
import fs from 'fs';
import path from 'path';
import { exec, ExecException } from 'child_process';

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

	return {
		path: targetDir,
		cleanup: async () => fs.promises.rm(targetDir, { recursive: true }),
	};
}

type CliOutput = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export async function runCliForTesting(
	command: string,
	env: Record<string, string>,
): Promise<CliOutput> {
	return new Promise((res, rej) => {
		const out = { stdout: '', stderr: '' };
		const proc = exec(
			command,
			{ env: { ...process.env, ...env } },
			(error, stdout, stderr) => {
				if (error) {
					console.warn(error);
				}

				out.stdout += stdout;
				out.stderr += stderr;
			},
		);

		// Using `close` instead of `exit` to ensure that `stdio` has been fully
		// written before resolving the promise
		proc.on('close', (exitCode) => {
			res({
				...out,
				exitCode: exitCode ?? 1,
			});
		});
	});
}
