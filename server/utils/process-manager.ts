import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';

import createDebug from 'debug';
import omitBy from 'lodash/omitBy';

import { ConfigManager } from '../services/config';
import { ExecUtils } from './exec';
import { fmt } from './fmt';
import { RunningProcessModel } from '../models/RunningProcess.model';

const debug = createDebug('sidekick:process');

const ProcessLogsDirectory = path.join(ConfigManager.getSidekickPath(), 'logs');

fs.promises.mkdir(ProcessLogsDirectory, { recursive: true }).catch((error) => {
	console.error(error);
	process.exit(1);
});

export class ProcessManager {
	private static getProcessLogFile(name: string) {
		return path.join(ProcessLogsDirectory, `${name}.log`);
	}

	static getScopedName(serviceName: string, devServer: string) {
		return (serviceName + '-' + devServer)
			.replace(/\W+/g, '-')
			.replace(/^-|-$/g, '')
			.toLowerCase();
	}

	static async start(
		serviceName: string,
		devServerName: string,
		cmd: string,
		appDir: string,
		options: childProcess.SpawnOptionsWithoutStdio,
	) {
		const env = omitBy({ ...process.env, ...options.env }, (_, key) => {
			return key.startsWith('npm_');
		}) as any;

		const name = this.getScopedName(serviceName, devServerName);
		const child = childProcess.spawn(
			`/bin/bash`,
			['-c', `${cmd} &> ${this.getProcessLogFile(name)}`],
			{
				...options,
				env,
				detached: true,
				stdio: 'ignore',
			},
		);
		child.unref();
		const pid = child.pid;
		debug(fmt`Started ${name} with pid ${pid}: ${cmd}`);
		if (!pid) {
			throw new Error(`Failed to get pid of child`);
		}

		try {
			await RunningProcessModel.repository.insert({
				_id: name,
				pid,
				serviceName,
				devServerName,
				devServerScript: cmd,
				workdir: appDir,
				environment: env as any,
			});
		} catch (err: any) {
			console.error(err.stack);
			throw Object.assign(
				new Error(`Started service, but failed to record pid in sidekick`),
				{ cause: err },
			);
		}

		return pid;
	}

	static watchLogs({
		name,
		lines = 200,
		follow = true,
	}: {
		name: string;
		lines?: number;
		follow?: boolean;
	}) {
		return ExecUtils.runAndStream(
			`tail -n ${lines} ${follow ? '-f' : ''} ${this.getProcessLogFile(name)}`,
		);
	}

	static async stop(serviceName: string, devServerName: string) {
		const name = this.getScopedName(serviceName, devServerName);
		if (await this.isProcessCreated(name)) {
			await ExecUtils.treeKill(
				await this.getPID(name),
				os.constants.signals.SIGKILL,
			);
			await RunningProcessModel.repository.remove({
				_id: name,
			});
		}
	}

	static async removeLogFile(serviceName: string, devServerName: string) {
		try {
			await fs.promises.unlink(
				this.getProcessLogFile(this.getScopedName(serviceName, devServerName)),
			);
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	static async pause(serviceName: string, devServerName: string) {
		const name = this.getScopedName(serviceName, devServerName);
		await ExecUtils.treeKill(
			await this.getPID(name),
			os.constants.signals.SIGSTOP,
		);
	}

	static async resume(serviceName: string, devServerName: string) {
		const name = this.getScopedName(serviceName, devServerName);
		await ExecUtils.treeKill(
			await this.getPID(name),
			os.constants.signals.SIGCONT,
		);
	}

	static async isSuspended(name: string) {
		try {
			return await ExecUtils.isSuspended(await this.getPID(name));
		} catch (error: any) {
			if (error.code === 'PROCESS_NOT_RUNNING') {
				return false;
			}
			throw error;
		}
	}

	static async getPID(name: string): Promise<number> {
		const processInfo = await RunningProcessModel.repository.findOne({
			_id: name,
		});
		if (!processInfo) {
			throw Object.assign(
				new Error(`Could not find a running process named '${name}'`),
				{
					code: 'PROCESS_NOT_RUNNING',
				},
			);
		}
		return processInfo.pid;
	}

	static async isPidRunning(pid: number): Promise<boolean> {
		try {
			process.kill(pid, 0);
			debug(fmt`Found ${name} running at ${pid}`);
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

	static async isProcessRunning(name: string): Promise<boolean> {
		try {
			const pid = await this.getPID(name);
			process.kill(pid, 0);
			debug(fmt`Found ${name} running at ${pid}`);
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

	static async isProcessCreated(name: string): Promise<boolean> {
		return !!(await RunningProcessModel.repository.findOne({
			_id: name,
		}));
	}
}
