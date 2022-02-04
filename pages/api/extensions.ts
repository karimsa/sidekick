import * as t from 'io-ts';
import slugify from 'slugify';
import * as path from 'path';

import { createRpcMethod } from '../../utils/http';
import { ExtensionBuilder } from '../../utils/extensions';
import { ConfigManager } from '../../services/config';
import { ExecUtils } from '../../utils/exec';

export const getExtensions = createRpcMethod(t.interface({}), async function () {
    const config = await ConfigManager.loadProjectOverrides();
    return Promise.all(
        config.extensions.map(async extensionPath => {
            const extensionId = slugify(path.basename(extensionPath));
            try {
                const { client } = await ExtensionBuilder.getExtension(extensionPath);
                return { id: extensionId, extensionPath, code: client };
            } catch (error: any) {
                return {
                    id: extensionId,
                    extensionPath,
                    code: `throw new Error(${JSON.stringify(String(error))})`
                };
            }
        })
    );
});

export const runExtensionMethod = createRpcMethod(
    t.interface({
        extensionPath: t.string,
        methodName: t.string,
        params: t.array(t.unknown)
    }),
    async ({ extensionPath, methodName, params }) => {
        const config = await ConfigManager.loadProjectOverrides();
        if (!config.extensions.includes(extensionPath)) {
            throw new Error(`No extension found at: ${extensionPath}`);
        }

        const projectPath = await ConfigManager.getProjectPath();
        const { server } = await ExtensionBuilder.getExtension(extensionPath);
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
                cwd: path.resolve(projectPath, path.dirname(extensionPath))
            }
        );
        return { result };
    }
);
