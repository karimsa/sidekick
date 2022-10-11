import { z } from 'zod';

import { ConfigManager } from '../services/config';
import { createRpcMethod } from '../utils/http';
import { getSidekickVersion } from '../cli/version';

export const getConfig = createRpcMethod(z.object({}), async function () {
	const config = await ConfigManager.createProvider();
	return config.getAll();
});

export const getVersion = createRpcMethod(z.object({}), async () => {
	const config = await ConfigManager.createProvider();
	const { projectName, projectVersion } = await config.getAll();
	const sidekickVersion = await getSidekickVersion();

	return {
		project: {
			name: projectName,
			version: projectVersion,
		},
		sidekick: sidekickVersion,
	};
});

export const updateConfig = createRpcMethod(
	z.record(z.string(), z.unknown()),
	async function (updates) {
		const config = await ConfigManager.createProvider();
		await config.setAll(updates as any);
		return config.getAll();
	},
);
