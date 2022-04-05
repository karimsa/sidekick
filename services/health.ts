import { ServiceList } from './service-list';
import { testHttp, testTcp } from '../utils/healthcheck';
import { assertUnreachable, objectKeys } from '../utils/util-types';
import { ProcessManager } from '../utils/process-manager';
import { HealthStatus, isActiveStatus } from '../utils/shared-types';
import { ServiceBuildHistoryModel } from '../server/models/ServiceBuildHistory.model';

export class HealthService {
	static async getServiceHealth(name: string) {
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
			return {
				healthStatus: HealthStatus.healthy,
				version: serviceConfig.version,
			};
		}

		// If any of the processes are suspended, we consider the whole process to be suspended
		else if (numSuspendedProcesses > 0) {
			return {
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
			return {
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
			return {
				healthStatus: HealthStatus.zombie,
				version: serviceConfig.version,
			};
		}

		// If all the expected processes are running, but we are not receiving any response on ports,
		// the service is completely failing
		else if (
			(numRunningProcesses === numExpectedProcesses && numPortsHealthy === 0) ||
			numCreatedProcesses > numRunningProcesses
		) {
			return {
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
			return {
				healthStatus: HealthStatus.partial,
				version: serviceConfig.version,
			};
		} else {
			// TODO: Identify stale builds

			if (name.endsWith('labs-server')) {
				await ServiceBuildHistoryModel.isServiceStale(serviceConfig);
			}

			return {
				healthStatus: HealthStatus.none,
				version: serviceConfig.version,
			};
		}
	}

	static async waitForHealthStatus(
		name: string,
		targetStatusList: HealthStatus[],
		abortController: AbortController,
	) {
		while (!abortController.signal.aborted) {
			const currentStatus = await this.getServiceHealth(name);
			if (targetStatusList.includes(currentStatus.healthStatus)) {
				return currentStatus;
			}
		}
	}

	static async waitForActive(name: string, abortController: AbortController) {
		while (!abortController.signal.aborted) {
			const currentStatus = await this.getServiceHealth(name);
			if (isActiveStatus(currentStatus.healthStatus)) {
				return currentStatus;
			}
		}
	}
}
