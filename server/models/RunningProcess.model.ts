import { Model } from '../utils/Model';
import { z } from 'zod';

export class RunningProcessModel extends Model(
	'processes',
	z.object({
		_id: z.string(),
		pid: z.number(),
		serviceName: z.string(),
		devServerName: z.string(),
		devServerScript: z.string(),
		workdir: z.string(),
		environment: z.record(z.string(), z.string()),
		startedAt: z.string().optional(),
	}),
) {}
