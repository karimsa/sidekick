import { z } from 'zod';

import { ConfigManager } from '../services/config';
import { createRpcMethod } from '../utils/http';

export const getConfig = createRpcMethod(z.object({}), async function () {
	const config = await ConfigManager.createProvider();
	return config.getAll();
});

export const updateConfig = createRpcMethod(
	z.record(z.string(), z.unknown()),
	async function (updates) {
		const config = await ConfigManager.createProvider();
		await config.setAll(updates as any);
		return config.getAll();
	},
);
