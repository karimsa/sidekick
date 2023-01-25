import isEqual from 'lodash/isEqual';
import {
	ChannelList,
	CHANNEL_DESTROYED,
	CHANNEL_TIMEOUT,
} from '../utils/channel';
import { testHealthCheck } from '../utils/healthcheck';
import { ProcessManager } from '../utils/process-manager';
import { HealthStatus } from '../utils/shared-types';
import { startTask } from '../utils/TaskRunner';
import { objectKeys } from '../utils/util-types';
import { Logger } from './logger';
import { ServiceBuildsService } from './service-builds';
import { ServiceConfig, ServiceList } from './service-list';

const logger = new Logger('health');

// keys are service locations
const healthsPerService = new Map<string, ServiceHealthEvent>();
export const HealthUpdates = new ChannelList<ServiceHealthEvent>();

const serviceTask = startTask('serviceHealthMonitor', async () => {
	let serviceConfigs: ServiceConfig[] = [];
	let lastUpdatedServiceList = -Infinity;
	const wait = 1000;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		await new Promise((resp) => setTimeout(resp, wait));

		if (HealthUpdates.size === 0) {
			continue;
		}

		const now = Date.now();

		try {
			// loading the service configs is not the fastest operation; we don't
			// expect them to change often so might as well simply not load them often
			if (lastUpdatedServiceList < now - 5_000) {
				serviceConfigs = await ServiceList.getServices();
				lastUpdatedServiceList = now;
			}

			const outcome = await Promise.allSettled(
				serviceConfigs.map(async (config) => {
					const previous = healthsPerService.get(config.location);

					const health: ServiceHealthEvent = {
						previousHealthInfo: healthsPerService.get(config.location)
							?.healthInfo,
						healthInfo: await HealthService.fetchServiceHealth(config),
						serviceName: config.name,
						location: config.location,
						version: config.version,
					};

					if (!isEqual(previous, health)) {
						healthsPerService.set(config.location, health);
						HealthUpdates.send(health);
						logger.info(`Service health changed`, {
							serviceName: config.name,
							previousHealth: previous,
							updatedHealth: health,
						});
					}
				}),
			);

			for (const result of outcome) {
				if (result.status === 'rejected') {
					logger.error('Sidekick status check failed:', {
						err: result.reason,
					});
				}
			}
		} catch (err) {
			logger.error('Sidekick health loop failed:', {
				err,
			});
		}
	}
});

interface ServiceHealth {
	healthStatus: HealthStatus;
	tags: string[];
}

interface ServiceHealthEvent {
	previousHealthInfo?: ServiceHealth;
	healthInfo: ServiceHealth;

	serviceName: string;
	location: string;
	version: string;
}

interface ServiceHealth {
	healthStatus: HealthStatus;
	tags: string[];
}

export class HealthService {
	static readonly startMonitor = serviceTask;

	static async getServiceHealth(
		serviceConfig: ServiceConfig,
	): Promise<ServiceHealth> {
		const saved = healthsPerService.get(serviceConfig.location);
		if (saved) {
			return saved.healthInfo;
		}

		return this.fetchServiceHealth(serviceConfig);
	}

	static async fetchServiceHealth(
		serviceConfig: ServiceConfig,
	): Promise<ServiceHealth> {
		const name = serviceConfig.name;

		const portStatuses = await Promise.all(
			serviceConfig.ports.map(async (testOptions) => {
				return testHealthCheck(serviceConfig.name, testOptions);
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
			return {
				healthStatus: HealthStatus.healthy,
				tags: ['all', 'running', ...serviceConfig.rawTags],
			};
		}

		// If any of the processes are suspended, we consider the whole process to be suspended
		else if (numSuspendedProcesses > 0) {
			return {
				healthStatus: HealthStatus.paused,
				tags: ['all', 'running', ...serviceConfig.rawTags],
			};
		}

		// If the all the expected ports are responding, but the process manager was not able to
		// locate all the processes, we have entered zombie mode
		else if (numCreatedProcesses === 0 && numPortsHealthy > 0) {
			return {
				healthStatus: HealthStatus.zombie,
				tags: ['all', 'running', ...serviceConfig.rawTags],
			};
		}

		// If any expected processes are not running, the service is failing
		else if (
			numCreatedProcesses > 0 &&
			numRunningProcesses !== numExpectedProcesses
		) {
			return {
				healthStatus: HealthStatus.failing,
				tags: ['all', 'running', ...serviceConfig.rawTags],
			};
		}

		// If all the expected processes are running, but only some of the ports are responding, the
		// service has partial availability
		else if (
			numRunningProcesses === numExpectedProcesses &&
			numPortsHealthy < serviceConfig.ports.length
		) {
			return {
				healthStatus: HealthStatus.partial,
				tags: ['all', 'running', ...serviceConfig.rawTags],
			};
		} else if (await ServiceBuildsService.isServiceStale(serviceConfig)) {
			return {
				healthStatus: HealthStatus.stale,
				tags: ['all', 'running', ...serviceConfig.rawTags],
			};
		} else {
			return {
				healthStatus: HealthStatus.none,
				tags: ['all', ...serviceConfig.rawTags],
			};
		}
	}

	static getSavedHealthStatus() {
		return [...healthsPerService.values()];
	}

	static async getStaleServices() {
		const services = await ServiceList.getServices();
		return (
			await Promise.all(
				services.map(async (service) => {
					const serviceHealth = await HealthService.getServiceHealth(service);
					if (serviceHealth.healthStatus === HealthStatus.stale) {
						return [service];
					}
					return [];
				}),
			)
		).flat();
	}

	static async waitForHealthStatus(
		{ location }: ServiceConfig,
		targetStatusList: HealthStatus[],
		abortController: AbortController,
	) {
		const savedStatus = healthsPerService.get(location);
		if (
			savedStatus &&
			targetStatusList.includes(savedStatus.healthInfo.healthStatus)
		) {
			return savedStatus;
		}

		const channel = HealthUpdates.watch();
		while (!abortController.signal.aborted) {
			const status = await channel.read(5000);
			if (status === CHANNEL_DESTROYED) {
				break;
			}

			if (status === CHANNEL_TIMEOUT) {
				continue;
			}

			if (
				status.location === location &&
				targetStatusList.includes(status.healthInfo.healthStatus)
			) {
				return status;
			}
		}

		channel.destroy();
	}
}
