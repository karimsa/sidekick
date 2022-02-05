import * as t from 'io-ts';
import * as path from 'path';

import { createRpcMethod } from '../../utils/http';
import { ExtensionBuilder } from '../../utils/extensions';
import { ConfigManager } from '../../services/config';
import { ExecUtils } from '../../utils/exec';

export const getExtensions = createRpcMethod(t.interface({}), async function () {
    const config = await ConfigManager.loadProjectOverrides();
    return Promise.all(
        config.extensions.map(async extensionPath => {
            try {
                const client = await ExtensionBuilder.getExtensionClient(extensionPath);
                return { extensionPath, code: client };
            } catch (error: any) {
                return {
                    extensionPath,
                    code: `throw new Error(${JSON.stringify(`${String(error)} (failed to build)`)})`
                };
            }
        })
    );
});

export const runExtensionMethod = createRpcMethod(
    t.intersection([
        t.interface({
            extensionPath: t.string,
            methodName: t.string,
            params: t.array(t.unknown)
        }),
        t.partial({
            targetEnvironment: t.string,
            environment: t.record(t.string, t.string),
            nodeOptions: t.array(t.string)
        })
    ]),
    async ({ extensionPath, methodName, params, targetEnvironment, environment, nodeOptions }) => {
        const sidekickConfig = await ConfigManager.loadProjectOverrides();
        if (!sidekickConfig.extensions.includes(extensionPath)) {
            throw new Error(`No extension found at: ${extensionPath}`);
        }

        const config = await ConfigManager.createProvider();
        const targetEnvironments = await config.getValue('environments');
        const targetEnvironmentVars = targetEnvironment ? targetEnvironments[targetEnvironment] : {};

        const projectPath = await ConfigManager.getProjectPath();
        const server = await ExtensionBuilder.getExtensionServer(extensionPath);
        const result = await ExecUtils.runJS(
            async function (require, { server, methodName, params }) {
                const modulePolyfill = { exports: {} as any };
                const moduleLoader = new Function('module', 'exports', 'require', `(function(){ ${server} }())`);
                moduleLoader(modulePolyfill, modulePolyfill.exports, require);

                const method = modulePolyfill.exports[methodName];
                if (!method) {
                    throw new Error(`Failed to find exported extension method '${methodName}'`);
                }

                return method.apply(this, params);
            },
            { server, methodName, params },
            {
                cwd: path.resolve(projectPath, path.dirname(extensionPath)),
                nodeOptions,
                env: {
                    ...environment,
                    ...targetEnvironmentVars
                }
            }
        );
        return { result };
    }
);
