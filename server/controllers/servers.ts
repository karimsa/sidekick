import * as t from 'io-ts';
import { createRpcMethod, createStreamingRpcMethod } from '../../utils/http';
import { ServiceList } from '../../services/service-list';
import { ConfigManager } from '../../services/config';
import { assertUnreachable, objectEntries } from '../../utils/util-types';
import { ProcessManager } from '../../utils/process-manager';
import { ExecUtils } from '../../utils/exec';
import * as os from 'os';
import { EventEmitter, on } from 'events';
import { AbortController } from 'node-abort-controller';
import { RunningProcessModel } from '../models/RunningProcess.model';
import { HealthService } from '../../services/health';
import { HealthStatus } from '../../utils/shared-types';

export const getServices = createRpcMethod(t.interface({}), async function () {
	return ServiceList.getServices();
});

export const getZombieProcessInfo = createRpcMethod(
	t.interface({
		name: t.string,
	}),
	async function ({ name }) {
		const serviceConfig = await ServiceList.getService(name);
		const results = await Promise.all(
			serviceConfig.ports.map(async (port) => {
				const output = await ExecUtils.runCommand(
					`lsof`,
					[`-i`, `:${port.port}`],
					{
						ignoreExitCode: true,
					},
				);
				const results = output
					.trim()
					.split(/\n/g)
					.filter((line) => line.includes('LISTEN'));
				if (results.length === 0) {
					return [];
				}

				const pid = results[0]?.split(/\s+/g)[1];
				if (isNaN(Number(pid))) {
					console.dir({ output, results, pid });
					throw new Error(
						`Failed to obtain pid of process running on ${port.port}`,
					);
				}

				const command = await ExecUtils.runCommand(`ps`, [
					`-o`,
					`command=`,
					`-p`,
					pid,
				]);
				return [{ port: port.port, pid: Number(pid), command: command.trim() }];
			}),
		);
		return results.flat();
	},
);

export const killProcesses = createRpcMethod(
	t.interface({ pids: t.array(t.number) }),
	async ({ pids }) => {
		await Promise.all(
			pids.map(async (pid) => {
				await ExecUtils.treeKill(pid, os.constants.signals.SIGKILL);
			}),
		);
	},
);

export const getServerHealth = createStreamingRpcMethod(
	t.interface({
		name: t.string,
	}),
	async function* ({ name }, abortController) {
		while (!abortController.signal.aborted) {
			yield HealthService.getServiceHealth(name);
			await new Promise<void>((resolve) => {
				setTimeout(() => resolve(), 5e3);
			});
		}
	},
);

export const getService = createRpcMethod(
	t.interface({ name: t.string }),
	async ({ name }) => {
		return ServiceList.getService(name);
	},
);

export const getServiceProcessInfo = createRpcMethod(
	t.interface({ serviceName: t.string, devServer: t.string }),
	async ({ serviceName, devServer }) => {
		return RunningProcessModel.repository.findOne({
			_id: ProcessManager.getScopedName(serviceName, devServer),
		});
	},
);

export const startService = createRpcMethod(
	t.interface({
		name: t.string,
		targetEnvironment: t.string,
		environment: t.record(t.string, t.string),
	}),
	async ({ name, targetEnvironment, environment }) => {
		const serviceConfig = await ServiceList.getService(name);

		const config = await ConfigManager.createProvider();
		const envVarsFromTarget = (await config.getValue('environments'))[
			targetEnvironment
		];
		if (!envVarsFromTarget) {
			throw new Error(
				`Could not find '${targetEnvironment}' defined in the config`,
			);
		}
		const envVars = {
			...environment,
			...envVarsFromTarget,
		};

		await Promise.all(
			objectEntries(serviceConfig.devServers).map(
				([devServerName, runCommand]) => {
					return ProcessManager.start(
						name,
						devServerName,
						runCommand,
						serviceConfig.location,
						{
							cwd: serviceConfig.location,
							env: envVars as any,
						},
					);
				},
			),
		);

		await HealthService.waitForActive(name, new AbortController());

		return { ok: true };
	},
);

export const stopService = createRpcMethod(
	t.interface({
		name: t.string,
	}),
	async ({ name }) => {
		const serviceConfig = await ServiceList.getService(name);

		await Promise.all(
			objectEntries(serviceConfig.devServers).map(async ([devServerName]) => {
				await ProcessManager.stop(name, devServerName);
				await ProcessManager.removeLogFile(name, devServerName);
			}),
		);
		await HealthService.waitForHealthStatus(
			name,
			[HealthStatus.none],
			new AbortController(),
		);

		return { ok: true };
	},
);

export const bulkServiceAction = createRpcMethod(
	t.union([
		t.interface({
			serviceNames: t.array(t.string),
			action: t.literal('start'),
			targetEnvironment: t.string,
			environment: t.record(t.string, t.string),
		}),
		t.interface({
			serviceNames: t.array(t.string),
			action: t.union([t.literal('stop'), t.literal('pause')]),
			targetEnvironment: t.undefined,
			environment: t.undefined,
		}),
	]),
	async ({ serviceNames, action, targetEnvironment, environment }) => {
		const services = await ServiceList.getServices();
		const servicesUpdated: string[] = [];
		await Promise.all(
			services.map(async (service) => {
				if (serviceNames.includes(service.name)) {
					servicesUpdated.push(service.name);

					switch (action) {
						case 'start':
							await startService.run({
								name: service.name,
								targetEnvironment,
								environment,
							});
							break;

						case 'stop':
							await stopService.run({
								name: service.name,
							});
							break;

						case 'pause':
							break;

						default:
							assertUnreachable(action);
					}
				}
			}),
		);

		return servicesUpdated;
	},
);

export const getServiceLogs = createStreamingRpcMethod(
	t.interface({ name: t.string, devServer: t.string }),
	async function* ({ name, devServer }, abortController) {
		const emitter = new EventEmitter();
		const logsController = new AbortController();
		let streamError = null;

		ProcessManager.watchLogs({
			name: ProcessManager.getScopedName(name, devServer),
			abortController,
			onLogEntry(chunk) {
				emitter.emit('data', chunk);
			},
		}).then(
			() => {
				logsController.abort();
			},
			(error) => {
				streamError = error;
				logsController.abort();
			},
		);

		yield* on(emitter, 'data', {
			signal: logsController.signal,
		});

		if (streamError) {
			throw streamError;
		}
	},
);

export const restartDevServer = createRpcMethod(
	t.interface({
		serviceName: t.string,
		devServer: t.string,
		environment: t.record(t.string, t.string),
		resetLogs: t.boolean,
	}),
	async ({ serviceName, devServer, environment, resetLogs }) => {
		const processInfo = await RunningProcessModel.repository.findOne({
			_id: ProcessManager.getScopedName(serviceName, devServer),
		});
		if (!processInfo) {
			throw new Error(`Could not find running process matching query`);
		}

		await ProcessManager.stop(serviceName, devServer);

		if (resetLogs) {
			await ProcessManager.removeLogFile(serviceName, devServer);
		}

		await ProcessManager.start(
			serviceName,
			devServer,
			processInfo.devServerScript,
			processInfo.workdir,
			{
				cwd: processInfo.workdir,
				env: environment as any,
			},
		);

		return { ok: true };
	},
);
