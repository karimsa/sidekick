import { z } from 'zod';
import { Model } from '../utils/Model';
import { ServiceConfig } from '../../services/service-list';

export class ServiceBuildHistoryModel extends Model(
	'service-build-history',
	z.object({
		_id: z.string(),
		lastBuiltTime: z.date(),
	}),
) {
	static async getLastBuildEntry(serviceConfig: ServiceConfig) {
		return ServiceBuildHistoryModel.repository.findOne({
			_id: serviceConfig.location,
		});
	}

	static async updateLastBuildEntry(
		serviceConfig: ServiceConfig,
		updatedAt: Date,
	) {
		return ServiceBuildHistoryModel.repository.upsertById({
			_id: serviceConfig.location,
			lastBuiltTime: updatedAt,
		});
	}
}
