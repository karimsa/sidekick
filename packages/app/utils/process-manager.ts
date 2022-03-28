import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';

import createDebug from 'debug';

import { ConfigManager } from '../services/config';
import { ExecUtils } from './exec';
import { fmt } from './fmt';
import { NvmUtil } from './nvm.util';

const debug = createDebug('sidekick:process');

const ProcessPidDirectory = path.join(ConfigManager.getSidekickPath(), 'pids');
const ProcessLogsDirectory = path.join(ConfigManager.getSidekickPath(), 'logs');

Promise.all([
	fs.promises.mkdir(ProcessPidDirectory, { recursive: true }),
	fs.promises.mkdir(ProcessLogsDirectory, { recursive: true }),
]).catch((error) => {
	console.error(error);
	process.exit(1);
});

export class ProcessManager {
	private static getProcessPidFile(name: string) {
		return path.join(ProcessPidDirectory, `${name}.pid`);
	}
	private static getProcessLogFile(name: string) {
		return path.join(ProcessLogsDirectory, `${name}.log`);
	}

	static getScopedName(serviceName: string, devServer: string) {
		return (serviceName + '-' + devServer)
			.replace(/\W+/g, '-')
			.replace(/^-|-$/g, '');
	}

	static async start(
		name: string,
		cmd: string,
		appDir: string,
		options: childProcess.SpawnOptionsWithoutStdio,
	) {
		const child = childProcess.spawn(
			`/bin/bash`,
			[
				'-c',
				`${await NvmUtil.wrapVersionedCommand(
					appDir,
					cmd,
				)} &> ${this.getProcessLogFile(name)}`,
			],
			{
				...options,
				detached: true,
				stdio: 'ignore',
			},
		);
		child.unref();
		const pid = child.pid;
		console.warn(fmt`started ${name} with pid ${pid}: ${cmd}`);
		if (!pid) {
			throw new Error(`Failed to get pid of child`);
		}
		await fs.promises.writeFile(this.getProcessPidFile(name), String(pid));
	}

	static async watchLogs({
		name,
		onLogEntry,
		abortController,
	}: {
		name: string;
		onLogEntry: (chunk: string) => void;
		abortController: AbortController;
	}) {
		await ExecUtils.runCommand(
			`tail`,
			['-n', '200', '-f', this.getProcessLogFile(name)],
			{
				onStdout: onLogEntry,
				abortController,
			},
		);
	}

	static async stop(name: string) {
		if (await this.isProcessCreated(name)) {
			await ExecUtils.treeKill(
				await this.getPID(name),
				os.constants.signals.SIGKILL,
			);
			await Promise.all([
				fs.promises.unlink(this.getProcessPidFile(name)).catch((error) => {
					if (error.code !== 'ENOENT') {
						throw error;
					}
				}),
				fs.promises.unlink(this.getProcessLogFile(name)).catch((error) => {
					if (error.code !== 'ENOENT') {
						throw error;
					}
				}),
			]);
		}
	}

	static async pause(name: string) {
		await ExecUtils.treeKill(
			await this.getPID(name),
			os.constants.signals.SIGSTOP,
		);
	}

	static async resume(name: string) {
		await ExecUtils.treeKill(
			await this.getPID(name),
			os.constants.signals.SIGCONT,
		);
	}

	static async isSuspended(name: string) {
		try {
			return await ExecUtils.isSuspended(await this.getPID(name));
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return false;
			}
			throw error;
		}
	}

	static async getPID(name: string): Promise<number> {
		const pidFile = this.getProcessPidFile(name);
		const strPid = await fs.promises.readFile(pidFile, 'utf8');
		const pid = Number(strPid);
		if (Number.isNaN(pid)) {
			throw new Error(fmt`Corrupted pid file: ${pidFile} (read: ${strPid})`);
		}
		return pid;
	}

	static async isProcessRunning(name: string): Promise<boolean> {
		try {
			const pid = await this.getPID(name);
			process.kill(pid, 0);
			debug(fmt`Found ${name} running at ${pid}`);
			return true;
		} catch (error: any) {
			// ENOENT means the pidfile wasn't found
			// ESRCH means the signal failed to send
			if (
				error.code === 'ENOENT' ||
				error.code === 'ESRCH' ||
				String(error).match(/Corrupted pid file/)
			) {
				return false;
			}
			throw error;
		}
	}

	static async isProcessCreated(name: string): Promise<boolean> {
		try {
			await this.getPID(name);
			return true;
		} catch (error: any) {
			// ENOENT means the pidfile wasn't found
			if (
				error.code === 'ENOENT' ||
				String(error).match(/Corrupted pid file/)
			) {
				return false;
			}
			throw error;
		}
	}
}
