import * as childProcess from 'child_process';
import { SpawnOptionsWithStdioTuple } from 'child_process';
import * as os from 'os';
import treeKill from 'tree-kill';
import * as tmp from 'tmp-promise';
import stripAnsi from 'strip-ansi';
import * as execa from 'execa';
import * as fs from 'fs';
import { fmt } from './fmt';
import { ConfigManager } from '../services/config';
import { AbortController } from 'node-abort-controller';
import { Observable } from 'rxjs';
import { Logger } from '../services/logger';

const logger = new Logger('exec');
const isDevelopment =
	!process.env.NODE_ENV || process.env.NODE_ENV === 'development';

type RunOptions = Omit<childProcess.ExecOptions, 'env'> & {
	stdin?: string;
	onStdout?: (chunk: string) => void;
	abortController?: AbortController;
	env?: Record<string, string>;
	ignoreExitCode?: boolean;
};

export class ExecUtils {
	static async runJS<Result, Params = Record<string, unknown>>(
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
            const resolve = require('${require.resolve('resolve')}').sync
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
		await fs.promises.writeFile(tmpFilePath, script);

		// TODO: Handle node versioning
		// run script in the right project
		const nodeOptions = options?.nodeOptions ?? [];
		await ExecUtils.runCommand(
			process.env.SHELL!,
			['-c', `${process.argv[0]} ${nodeOptions} ${tmpFilePath}`],
			{ ...options, cwd: projectDir },
		);
		const resData = await fs.promises.readFile(outputSocket, 'utf8');
		logger.debug(`JS code returned`, {
			data: resData.slice(0, 50),
			tmpFilePath,
		});

		// act on result
		const { type, result, error } = JSON.parse(resData);
		if (type === 'success') {
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

			logger.debug(`Starting process`, {
				...childProcessOptions,
				cmdPath,
				args,
				env: '(omitted)',
			});
			const child = childProcess.spawn(cmdPath, args, childProcessOptions);
			child.on('spawn', () => {
				logger.debug(`Process got a pid`, { pid: child.pid, cmdPath });
			});
			child.stdout!.on('data', (chunk) => {
				const chunkStr = chunk.toString('utf8');
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
				logger.debug(`Process exited`, { code, cmdPath });
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

	static runAndStream(
		command: string,
		options?: Omit<execa.Options, 'stdio' | 'stdout' | 'stderr'>,
	) {
		return new Observable<string>((subscriber) => {
			logger.debug(`Starting streaming command`, { command });
			const child = execa.command(command, {
				stdin: 'ignore',
				...options,
				stdout: 'pipe',
				stderr: 'pipe',
			});
			child.stdout!.on('data', (chunk) =>
				subscriber.next(stripAnsi(chunk.toString())),
			);
			child.stderr!.on('data', (chunk) =>
				subscriber.next(stripAnsi(chunk.toString())),
			);
			child
				.then(() => subscriber.complete())
				.catch((error) => subscriber.error(error))
				.then(() => logger.debug(fmt`Streaming process exited`, { command }));
			return () => {
				if (child.connected) {
					logger.debug(`Received abort signal, killing process`, { command });
					child.kill();
				}
			};
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

	static async treeKillAndWait(pid: number, signal: number) {
		do {
			await this.treeKill(pid, signal);
			await new Promise((resolve) => setTimeout(resolve, 100));
		} while (await this.isPidRunning(pid));
	}

	static async isPidRunning(pid: number): Promise<boolean> {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error: any) {
			// ESRCH means the signal failed to send
			if (
				error.code === 'ESRCH' ||
				error.code === 'PROCESS_NOT_RUNNING' ||
				String(error).match(/Corrupted pid file/)
			) {
				return false;
			}
			throw error;
		}
	}
}
