import * as childProcess from 'child_process';
import execa from 'execa';
import * as fs from 'fs';
import omitBy from 'lodash/omitBy';
import * as os from 'os';
import * as path from 'path';

import { RunningProcessModel } from '../models/RunningProcess.model';
import { ConfigManager } from '../services/config';
import { Logger } from '../services/logger';
import { ExecUtils } from './exec';
import { memoize } from './memoize';
import { startTask } from './TaskRunner';

const logger = new Logger('process');
const ProcessLogsDirectory = path.join(ConfigManager.getSidekickPath(), 'logs');

fs.promises.mkdir(ProcessLogsDirectory, { recursive: true }).catch((error) => {
	console.error(error);
	process.exit(1);
});

const getLastRebootTime = memoize(async () => {
	try {
		// Tue Jan  3 12:17:52 2023
		const { stdout } = await execa.command('sysctl kern.boottime');
		const [, secs] = stdout.match(/\{ sec = ([0-9]+)/) ?? [];
		if (!secs) {
			return new Date(0);
		}
		return new Date(Number(secs) * 1e3);
	} catch {
		return new Date(0);
	}
});
getLastRebootTime().catch(() => {});

startTask('Destroy old processes', async () => {
	const { stdout } = await execa.command('sysctl kern.boottime');
	const [, secs] = stdout.match(/\{ sec = ([0-9]+)/) ?? [];
	const lastReboot = new Date(Number(secs) * 1e3).toISOString();
	logger.info(`Starting cleaning of old processes`, {
		lastReboot,
	});

	const oldEntries = (await RunningProcessModel.repository.find({})).filter(
		(entry) => {
			return entry.startedAt && entry.startedAt < lastReboot;
		},
	);
	if (oldEntries.length === 0) {
		logger.info(`No old processes to destroy`);
		return;
	}

	for (const entry of oldEntries) {
		logger.info(`Destroying old process`, {
			name: entry._id,
			pid: entry.pid,
		});
		await RunningProcessModel.repository.remove({
			_id: entry._id,
		});
	}
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
		logger.debug(`Started process`, {
			name,
			pid,
			cmd,
		});
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
				startedAt: new Date().toISOString(),
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
		const entry = await RunningProcessModel.repository.findOne({
			_id: name,
		});
		return !!entry;
	}
}
