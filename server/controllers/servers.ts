import { createRpcMethod, createStreamingRpcMethod } from '../utils/http';
import { ServiceList } from '../services/service-list';
import { ConfigManager } from '../services/config';
import { assertUnreachable, objectEntries } from '../utils/util-types';
import { ProcessManager } from '../utils/process-manager';
import { ExecUtils } from '../utils/exec';
import * as os from 'os';
import { AbortController } from 'node-abort-controller';
import { RunningProcessModel } from '../models/RunningProcess.model';
import { HealthService } from '../services/health';
import { HealthStatus, isActiveStatus } from '../utils/shared-types';
import { z } from 'zod';
import * as path from 'path';
import { ServiceBuildsService } from '../services/service-builds';
import { split } from '../utils/split';
import { merge, Observable, Subscriber } from 'rxjs';

export const getServices = createRpcMethod(z.object({}), async function () {
	return ServiceList.getServices();
});

export const getZombieProcessInfo = createRpcMethod(
	z.object({
		name: z.string(),
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
	z.object({ pids: z.array(z.number()) }),
	async ({ pids }) => {
		await Promise.all(
			pids.map(async (pid) => {
				await ExecUtils.treeKillAndWait(pid, os.constants.signals.SIGKILL);
			}),
		);
	},
);

type ServerHealthUpdate = {
	healthStatus: HealthStatus;
	tags: string[];
	version: string;
	serviceName: string;
};

const watchServerHealth = async (
	name: string,
	subscriber: Subscriber<ServerHealthUpdate>,
) => {
	while (!subscriber.closed) {
		subscriber.next({
			...(await HealthService.getServiceHealth(name)),
			serviceName: name,
		});

		await new Promise<void>((resolve) => {
			HealthService.waitForPossibleHealthChange(name).subscribe({
				complete: () => resolve(),
				error: () => resolve(),
			});
		});
	}
};

export const getBulkServerHealth = createStreamingRpcMethod(
	z.object({}),
	z.object({
		serviceName: z.string(),
		healthStatus: z.nativeEnum(HealthStatus),
		tags: z.array(z.string()),
		version: z.string(),
	}),
	async (_, subscriber) => {
		const services = await ServiceList.getServices();

		merge(
			...services.map(
				(serviceConfig) =>
					new Observable<ServerHealthUpdate>((subscriber) => {
						watchServerHealth(serviceConfig.name, subscriber).catch((error) => {
							subscriber.error(error);
						});
					}),
			),
		).subscribe(subscriber);
	},
);

export const getService = createRpcMethod(
	z.object({ name: z.string() }),
	async ({ name }) => {
		return ServiceList.getService(name);
	},
);

export const getServiceProcessInfo = createRpcMethod(
	z.object({ serviceName: z.string(), devServer: z.string() }),
	async ({ serviceName, devServer }) => {
		return RunningProcessModel.repository.findOne({
			_id: ProcessManager.getScopedName(serviceName, devServer),
		});
	},
);

export const startService = createRpcMethod(
	z.object({
		name: z.string(),
		targetEnvironment: z.string(),
		environment: z.record(z.string(), z.string()),
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
	z.object({
		name: z.string(),
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

export const pauseService = createRpcMethod(
	z.object({
		name: z.string(),
	}),
	async ({ name }) => {
		const serviceConfig = await ServiceList.getService(name);

		await Promise.all(
			objectEntries(serviceConfig.devServers).map(async ([devServerName]) => {
				await ProcessManager.pause(name, devServerName);
			}),
		);
		await HealthService.waitForHealthStatus(
			name,
			[HealthStatus.paused],
			new AbortController(),
		);

		return { ok: true };
	},
);

export const pauseDevServer = createRpcMethod(
	z.object({
		serviceName: z.string(),
		devServer: z.string(),
	}),
	async ({ serviceName, devServer }) => {
		const serviceConfig = await ServiceList.getService(serviceName);
		if (!serviceConfig.devServers[devServer]) {
			throw new Error(
				`Unrecognized dev server name: ${devServer} (under ${serviceName})`,
			);
		}

		await ProcessManager.pause(serviceName, devServer);
		await HealthService.waitForHealthStatus(
			serviceName,
			[HealthStatus.paused],
			new AbortController(),
		);

		return { ok: true };
	},
);

export const resumeDevServer = createRpcMethod(
	z.object({
		serviceName: z.string(),
		devServer: z.string(),
	}),
	async ({ serviceName, devServer }) => {
		const serviceConfig = await ServiceList.getService(serviceName);
		if (!serviceConfig.devServers[devServer]) {
			throw new Error(
				`Unrecognized dev server name: ${devServer} (under ${serviceName})`,
			);
		}

		await ProcessManager.resume(serviceName, devServer);
		await HealthService.waitForHealthStatus(
			serviceName,
			[HealthStatus.healthy, HealthStatus.failing, HealthStatus.partial],
			new AbortController(),
		);

		return { ok: true };
	},
);

export const resumeService = createRpcMethod(
	z.object({
		name: z.string(),
	}),
	async ({ name }) => {
		const serviceConfig = await ServiceList.getService(name);

		await Promise.all(
			objectEntries(serviceConfig.devServers).map(async ([devServerName]) => {
				await ProcessManager.resume(name, devServerName);
			}),
		);
		await HealthService.waitForHealthStatus(
			name,
			[HealthStatus.healthy, HealthStatus.failing, HealthStatus.partial],
			new AbortController(),
		);

		return { ok: true };
	},
);

export const prepareService = createStreamingRpcMethod(
	z.object({
		name: z.string(),
	}),
	z.string(),
	async function ({ name }, subscriber) {
		const serviceConfig = await ServiceList.getService(name);
		const observable = await ServiceBuildsService.buildService(serviceConfig);
		observable.subscribe(subscriber);
	},
);

export const prepareStaleServices = createStreamingRpcMethod(
	z.object({}),
	z.string(),
	async function (_, subscriber) {
		const services = await ServiceBuildsService.getStaleServices();
		if (services.length === 0) {
			subscriber.complete();
			return;
		}

		const observable = await ServiceBuildsService.buildServices(services);
		observable.subscribe(subscriber);
	},
);

export const getServiceScripts = createRpcMethod(
	z.object({ serviceName: z.string() }),
	async ({ serviceName }) => {
		const serviceConfig = await ServiceList.getService(serviceName);
		return Object.keys(serviceConfig.scripts);
	},
);

export const runServiceScript = createStreamingRpcMethod(
	z.object({
		serviceName: z.string(),
		scriptName: z.string(),
	}),
	z.string(),
	async function ({ serviceName, scriptName }, subscriber) {
		const serviceConfig = await ServiceList.getService(serviceName);
		const projectPath = await ConfigManager.getProjectPath();
		subscriber.next(
			`Running 'yarn ${scriptName}' in ${path.relative(
				projectPath,
				serviceConfig.location,
			)}\n\n`,
		);
		ExecUtils.runAndStream(`yarn ${scriptName}`, {
			cwd: serviceConfig.location,
		}).subscribe(subscriber);
	},
);

export const bulkServiceAction = createRpcMethod(
	z.union([
		z.object({
			serviceTag: z.string(),
			action: z.literal('start'),
			targetEnvironment: z.string(),
			environment: z.record(z.string(), z.string()),
		}),
		z.object({
			serviceTag: z.string(),
			action: z.union([
				z.literal('stop'),
				z.literal('pause'),
				z.literal('resume'),
			]),
			targetEnvironment: z.undefined(),
			environment: z.undefined(),
		}),
	]),
	async ({ serviceTag, action, targetEnvironment, environment }) => {
		const services = await ServiceList.getServicesByTag(serviceTag);
		const servicesUpdated: string[] = [];
		await Promise.all(
			services.map(async (service) => {
				servicesUpdated.push(service.name);
				const isServiceActive = isActiveStatus(
					(await HealthService.getServiceHealth(service.name)).healthStatus,
				);

				switch (action) {
					case 'start':
						if (!isServiceActive) {
							await startService.run({
								name: service.name,
								targetEnvironment,
								environment,
							});
						}
						break;

					case 'stop':
						if (isServiceActive) {
							await stopService.run({
								name: service.name,
							});
						}
						break;

					case 'pause':
						if (isServiceActive) {
							await pauseService.run({ name: service.name });
						}
						break;

					case 'resume':
						if (isServiceActive) {
							await resumeService.run({ name: service.name });
						}
						break;

					default:
						assertUnreachable(action);
				}
			}),
		);

		return servicesUpdated;
	},
);

export const getServiceLogs = createStreamingRpcMethod(
	z.object({ name: z.string(), devServer: z.string() }),
	z.string(),
	async function ({ name, devServer }, subscriber) {
		ProcessManager.watchLogs({
			name: ProcessManager.getScopedName(name, devServer),
		})
			.pipe(split(/\r?\n/g))
			.subscribe(subscriber);
	},
);

export const restartDevServer = createRpcMethod(
	z.object({
		serviceName: z.string(),
		devServer: z.string(),
		environment: z.record(z.string(), z.string()),
		resetLogs: z.boolean(),
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
