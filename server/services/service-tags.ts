import { HealthService } from './health';
import { HealthStatus } from '../utils/shared-types';
import { ServiceList, ServiceConfig } from './service-list';

export class ServiceTags {
	static async getServiceTags(name: string) {
		const serviceConfig = await ServiceList.getService(name);
		const tags = ['all', ...serviceConfig.rawTags];
		const health = await HealthService.getServiceHealth(serviceConfig);
		if (health.healthStatus !== HealthStatus.none) {
			tags.push('running');
		}
		return tags;
	}

	static async getServicesByTag(serviceTag: string) {
		const services: ServiceConfig[] = [];
		for (const service of await ServiceList.getServices()) {
			if ((await this.getServiceTags(service.name)).includes(serviceTag)) {
				services.push(service);
			}
		}
		return services;
	}
}
