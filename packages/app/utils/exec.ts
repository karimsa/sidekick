import * as childProcess from 'child_process';
import { SpawnOptionsWithStdioTuple } from 'child_process';
import * as os from 'os';
import createDebug from 'debug';
import treeKill from 'tree-kill';
import * as path from 'path';
import * as tmp from 'tmp-promise';
import stripAnsi from 'strip-ansi';
import * as execa from 'execa';
import * as fs from 'fs';
import { fmt } from './fmt';
import { ConfigManager } from '../services/config';

const debug = createDebug('sidekick:exec');
const verbose = createDebug('sidekick:exec:verbose');

type RunOptions = Omit<childProcess.ExecOptions, 'env'> & {
	stdin?: string;
	onStdout?: (chunk: string) => void;
	abortController?: AbortController;
	env?: Record<string, string>;
	ignoreExitCode?: boolean;
};

export class ExecUtils {
	static async runJS<Result, Params = {}>(
		remoteFn: (
			require: <T>(path: string) => T,
			params: Params,
		) => Promise<Result>,
		params?: Params,
		options?: RunOptions & { nodeOptions?: string[] },
	): Promise<Result> {
		const projectDir = options?.cwd ?? (await ConfigManager.getProjectPath());

		// generate script using function code
		const { path: tmpFilePath } = await tmp.file();
		const { path: outputSocket } = await tmp.file();
		const script = `
            const fs = require('fs')
            const path = require('path')
            const resolve = require('${path.resolve(
							__dirname,
							'node_modules',
							'resolve',
						)}').sync
            const root = process.cwd()
            const fakeRequire = p => require(resolve(p, { basedir: '${projectDir}' }))
            const entryPoint = ${remoteFn}

            const writeResult = result => fs.writeFileSync('${outputSocket}', JSON.stringify(result))

            entryPoint(fakeRequire, ${JSON.stringify(params ?? {})})
                .then(result => writeResult({ type: 'success', result }))
                .catch(error => {
                    console.error(error)
                    writeResult({ type: 'error', error: String(error.stack || error) })
                })
                .then(() => process.exit())

            setTimeout(function() {
                writeResult({ type: 'error', error: 'Script timed out' })
                process.exit()
            }, 30e3);
            `;
		verbose(fmt`Script generated: ${script}`);
		await fs.promises.writeFile(tmpFilePath, script);

		// TODO: Handle node versioning
		// run script in the right project
		const nodeOptions = options?.nodeOptions ?? [];
		await ExecUtils.runCommand(
			process.env.SHELL,
			[
				'-c',
				`source ~/.nvm/nvm.sh && nvm use 12.22.7 && node ${nodeOptions} ${tmpFilePath}`,
			],
			{ ...options, cwd: projectDir },
		);
		const resData = await fs.promises.readFile(outputSocket, 'utf8');
		debug(fmt`JS code returned: ${resData.slice(0, 50)}... (${tmpFilePath})`);

		// act on result
		const { type, result, error } = JSON.parse(resData);
		if (type === 'success' || !debug.enabled) {
			// delete temporary files
			await fs.promises.unlink(tmpFilePath);
			await fs.promises.unlink(outputSocket);

			return result;
		}
		throw new Error(error);
	}

	/**
	 * @deprecated
	 */
	static async runCommand(
		cmdPath: string,
		args: string[],
		options?: RunOptions,
	): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let stdout = '';
			let stderr = '';

			const childProcessOptions: SpawnOptionsWithStdioTuple<
				'pipe',
				'pipe',
				'pipe'
			> = {
				...(options ?? {}),
				stdio: ['pipe', 'pipe', 'pipe'],
				env: {
					...process.env,
					NODE_ENV: 'development',
					...(options?.env ?? {}),
				},
			};

			debug(
				fmt`Starting process with ${{
					...childProcessOptions,
					cmdPath,
					args,
					env: '(omitted)',
				}}`,
			);
			const child = childProcess.spawn(cmdPath, args, childProcessOptions);
			child.on('spawn', () => {
				debug(fmt`${cmdPath} got a pid: ${child.pid}`);
			});
			child.stdout!.on('data', (chunk) => {
				const chunkStr = chunk.toString('utf8');
				debug(fmt`stdout: ${stripAnsi(chunkStr)}`);
				stdout += chunkStr;
				options?.onStdout?.(chunkStr);
			});
			child.stderr!.on('data', (chunk) => {
				stderr += chunk.toString('utf8');
				process.stderr.write(chunk);
			});
			child.on('error', (error) => {
				reject(error);
			});
			child.on('exit', (code) => {
				debug(fmt`Process exited with code ${code}`);
				if (options?.ignoreExitCode || code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(stderr));
				}
			});

			if (options?.stdin) {
				child.stdin.write(options.stdin);
				child.stdin.end();
			}

			const abortController = options?.abortController;
			if (abortController) {
				if (abortController?.signal.aborted) {
					this.treeKill(child.pid!, os.constants.signals.SIGKILL);
				}
				abortController.signal.addEventListener('abort', () => {
					this.treeKill(child.pid!, os.constants.signals.SIGKILL);
					reject(new Error(`process aborted`));
				});
			}
		});
	}

	static async isSuspended(pid: number) {
		const { stdout } = await execa
			.command(`ps -o stat= -p ${pid}`)
			.catch((error) => {
				return error;
			});
		return String(stdout).includes('T');
	}

	static treeKill(pid: number, signal: number) {
		return new Promise<void>((resolve, reject) => {
			treeKill(pid, signal, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}
}
