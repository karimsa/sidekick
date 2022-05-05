import * as path from 'path';

import { createRpcMethod } from '../utils/http';
import { ExtensionBuilder } from '../utils/extensions';
import { ConfigManager } from '../services/config';
import { ExecUtils } from '../utils/exec';
import { z } from 'zod';

export const getExtensions = createRpcMethod(z.object({}), async function () {
	const config = await ConfigManager.loadProjectOverrides();
	return config.extensions;
});

export const getExtensionClient = createRpcMethod(
	z.object({ id: z.string() }),
	async function ({ id }) {
		const config = await ConfigManager.loadProjectOverrides();
		const extension = config.extensions?.find((ext) => ext.id === id);
		if (!extension) {
			throw new Error(`Extension with id '${id}' not found`);
		}

		try {
			const { clientCode, warnings } =
				await ExtensionBuilder.getExtensionClient(extension);
			return { id, config: extension, warnings, code: clientCode };
		} catch (error: any) {
			console.error(error);
			return {
				id,
				config: null,
				warnings: [],
				code: `throw new Error(${JSON.stringify(
					`${String(error)} (failed to build)`,
				)})`,
			};
		}
	},
);

export const runExtensionMethod = createRpcMethod(
	z.intersection(
		z.object({
			extensionId: z.string(),
			methodName: z.string(),
			params: z.unknown(),
		}),
		z.object({
			targetEnvironment: z.string().optional(),
			environment: z.record(z.string(), z.string()).optional(),
			nodeOptions: z.array(z.string()).optional(),
		}),
	),
	async ({
		extensionId,
		methodName,
		params,
		targetEnvironment,
		environment,
		nodeOptions,
	}) => {
		const sidekickConfig = await ConfigManager.loadProjectOverrides();
		const extension = sidekickConfig.extensions?.find(
			(ext) => ext.id === extensionId,
		);
		if (!extension) {
			throw new Error(`No extension found with id ${extensionId}`);
		}

		const config = await ConfigManager.createProvider();
		const targetEnvironments = await config.getValue('environments');
		const targetEnvironmentVars = targetEnvironment
			? targetEnvironments[targetEnvironment]
			: {};

		const projectPath = await ConfigManager.getProjectPath();
		const server = await ExtensionBuilder.getExtensionServer(extension);
		const result = await ExecUtils.runJS(
			async function (require, { server, methodName, params }) {
				const modulePolyfill = { exports: {} as any };
				const moduleLoader = new Function(
					'module',
					'exports',
					'require',
					`(function(){ ${server} }())`,
				);
				moduleLoader(modulePolyfill, modulePolyfill.exports, require);

				const method = modulePolyfill.exports[methodName];
				if (!method) {
					throw new Error(
						`Failed to find exported extension method '${methodName}'`,
					);
				}

				return method(params);
			},
			{ server, methodName, params },
			{
				cwd: path.resolve(projectPath, path.dirname(extension.entryPoint)),
				nodeOptions,
				env: {
					...environment,
					...targetEnvironmentVars,
					PROJECT_PATH: projectPath,
				},
			},
		);
		return { result };
	},
);
