import * as t from 'io-ts';

import { ConfigManager } from '../../services/config';
import { createRpcMethod } from '../../utils/http';

export const getConfig = createRpcMethod(t.interface({}), async function () {
	const config = await ConfigManager.createProvider();
	return config.getAll();
});

export const updateConfig = createRpcMethod(
	t.record(t.string, t.unknown),
	async function (updates) {
		const config = await ConfigManager.createProvider();
		await config.setAll(updates as any);
		return config.getAll();
	},
);
