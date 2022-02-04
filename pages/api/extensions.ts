import * as t from 'io-ts';
import slugify from 'slugify';

import { APIError, createRpcMethod, validate } from '../../utils/http';
import { ExtensionBuilder } from '../../utils/extensions';
import { ConfigManager } from '../../services/config';
import { ExecUtils } from '../../utils/exec';
import { loadModule } from '../../utils/load-module';

export const getExtensions = createRpcMethod(t.interface({}), async function () {
    const config = await ConfigManager.loadProjectOverrides();
    return Promise.all(
        config.extensions.map(async extensionPath => {
            try {
                const { client, server } = await ExtensionBuilder.getExtension(extensionPath);
                const config = validate(
                    t.interface({ title: t.string }),
                    loadModule(server, {
                        require() {}
                    }).config
                );

                return { id: slugify(config.title), extensionPath, code: client };
            } catch (error: any) {
                return {
                    id: slugify(extensionPath),
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

        const output = await ExecUtils.runCommand(`node`, {
            cwd: projectPath,
            stdin: `
                    const modulePolyfill = { exports: {} };
                    !function(module, exports){
                        ${server}
                    }(modulePolyfill, modulePolyfill.exports);
                    Promise.resolve()
                        .then(() => modulePolyfill.exports[${JSON.stringify(methodName)}].apply(this, ${JSON.stringify(
                params
            )}))
                        .then(result => console.log('\\0' + JSON.stringify({ result })))
                        .catch(error => console.log('\\0' + JSON.stringify({ error: String(error) })));
                `
        });
        const { result, error } = validate(
            t.partial({ result: t.unknown, error: t.string }),
            JSON.parse(output.split('\0')[1])
        );
        if (error) {
            throw new APIError(error, 500, error);
        }
        // wrapped in an object to stop the wrapper from parsing json
        return { result };
    }
);
