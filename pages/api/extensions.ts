import * as t from 'io-ts';
import * as fs from 'fs';
import * as path from 'path';
import slugify from 'slugify';

import { APIError, createRpcMethod, validate } from '../../utils/http';
import { ExtensionBuilder } from '../../utils/extensions';
import { ConfigManager } from '../../services/config';
import { ExecUtils } from '../../utils/exec';

export const getExtensions = createRpcMethod(t.interface({}), async function () {
    const config = await ConfigManager.loadProjectOverrides();
    const projectPath = await ConfigManager.getProjectPath();
    return Promise.all(
        config.extensions.map(async extensionPath => {
            const absPath = path.resolve(projectPath, extensionPath);
            const code = await fs.promises.readFile(absPath, 'utf8');
            const { client, server } = await ExtensionBuilder.splitServerClient(absPath, code);

            const loadModule = new Function(`module`, `exports`, `require`, `(function(){ ${server} }())`);
            const moduleExports: any = { exports: {} };
            loadModule(moduleExports, moduleExports.exports, mod => ({}));
            const config = validate(t.interface({ title: t.string }), moduleExports.exports.config);

            return { id: slugify(config.title), extensionPath, code: client };
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
        const absPath = path.resolve(projectPath, extensionPath);
        const code = await fs.promises.readFile(absPath, 'utf8');
        const { server } = await ExtensionBuilder.splitServerClient(absPath, code);

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
