import * as t from 'io-ts';
import { createRpcMethod, createStreamingRpcMethod } from '../../utils/http';
import { ServiceList } from '../../services/service-list';
import { ConfigManager } from '../../services/config';
import {
	assertUnreachable,
	objectEntries,
	objectKeys,
} from '../../utils/util-types';
import { ProcessManager } from '../../utils/process-manager';
import { testHttp, testTcp } from '../../utils/healthcheck';
import { HealthStatus } from '../../utils/shared-types';
import { ExecUtils } from '../../utils/exec';
import * as os from 'os';
import { EventEmitter, on } from 'events';
import { AbortController } from 'node-abort-controller';

/**
 * @deprecated Need to remove this.
 */
export const getServers = createRpcMethod(t.interface({}), async function () {
	return ServiceList.getServiceNames();
});

export const getServices = createRpcMethod(t.interface({}), async function () {
	return ServiceList.getServices();
});

export const getServiceTags = createRpcMethod(
	t.interface({}),
	async function () {
		const services = await ServiceList.getServices();
		return [...new Set(services.flatMap((service) => service.tags))];
	},
);

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
			const serviceConfig = await ServiceList.getService(name);

			const portStatuses = await Promise.all(
				serviceConfig.ports.map(async ({ type, port }) => {
					if (type === 'tcp') {
						return testTcp(port);
					} else if (type === 'http') {
						return testHttp(port);
					} else {
						assertUnreachable(type);
						throw new Error(`Unrecognized port type: '${type}'`);
					}
				}),
			);
			const numPortsHealthy = portStatuses.reduce((sum, portHealthy) => {
				return sum + (portHealthy ? 1 : 0);
			}, 0);

			let numCreatedProcesses = 0;
			let numRunningProcesses = 0;
			let numSuspendedProcesses = 0;
			await Promise.all(
				objectKeys(serviceConfig.devServers).map(async (devServer) => {
					if (
						await ProcessManager.isProcessCreated(
							ProcessManager.getScopedName(name, devServer),
						)
					) {
						numCreatedProcesses++;
					}
					if (
						await ProcessManager.isProcessRunning(
							ProcessManager.getScopedName(name, devServer),
						)
					) {
						numRunningProcesses++;
					}
					if (
						await ProcessManager.isSuspended(
							ProcessManager.getScopedName(name, devServer),
						)
					) {
						numSuspendedProcesses++;
					}
				}),
			);

			const numExpectedProcesses = Object.keys(serviceConfig.devServers).length;

			// If we have the right number of running processes, and all the ports are
			// responding as expected, we are healthy
			if (
				numExpectedProcesses > 0 &&
				numExpectedProcesses === numRunningProcesses &&
				numSuspendedProcesses === 0 &&
				numPortsHealthy === serviceConfig.ports.length
			) {
				yield {
					healthStatus: HealthStatus.healthy,
					version: serviceConfig.version,
				};
			}

			// If any of the processes are suspended, we consider the whole process to be suspended
			else if (numSuspendedProcesses > 0) {
				yield {
					healthStatus: HealthStatus.paused,
					version: serviceConfig.version,
				};
			}

			// If there are no processes and no response, the service is not running
			else if (
				numCreatedProcesses === 0 &&
				numRunningProcesses === 0 &&
				numPortsHealthy === 0
			) {
				yield {
					healthStatus: HealthStatus.none,
					version: serviceConfig.version,
				};
			}

			// If the all the expected ports are responding, but the process manager was not able to
			// locate all the processes, we have entered zombie mode
			else if (
				numRunningProcesses < numExpectedProcesses &&
				numPortsHealthy > 0
			) {
				yield {
					healthStatus: HealthStatus.zombie,
					version: serviceConfig.version,
				};
			}

			// If all the expected processes are running, but we are not receiving any response on ports,
			// the service is completely failing
			else if (
				(numRunningProcesses === numExpectedProcesses &&
					numPortsHealthy === 0) ||
				numCreatedProcesses > numRunningProcesses
			) {
				yield {
					healthStatus: HealthStatus.failing,
					version: serviceConfig.version,
				};
			}

			// If all the expected processes are running, but only some of the ports are responding, the
			// service has partial availability
			else if (
				numRunningProcesses === numExpectedProcesses &&
				numPortsHealthy < serviceConfig.ports.length
			) {
				yield {
					healthStatus: HealthStatus.partial,
					version: serviceConfig.version,
				};
			} else {
				// TODO: Identify stale builds
				yield {
					healthStatus: HealthStatus.none,
					version: serviceConfig.version,
				};
			}

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
						ProcessManager.getScopedName(name, devServerName),
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
			objectEntries(serviceConfig.devServers).map(([devServerName]) => {
				return ProcessManager.stop(
					ProcessManager.getScopedName(name, devServerName),
				);
			}),
		);

		return { ok: true };
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
