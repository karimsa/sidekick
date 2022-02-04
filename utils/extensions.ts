import * as babel from '@babel/core';
import * as esbuild from 'esbuild';
import * as path from 'path';
import getConfig from 'next/config';
import { ConfigManager } from '../services/config';
import resolveModulePath from 'resolve/async';
import * as util from 'util';

const resolveAsync = util.promisify(resolveModulePath);

export class ExtensionBuilder {
    static async splitServerClient(filePath: string, code: string): Promise<{ server: string; client: string }> {
        console.time('build extension');
        const fullAst = await babel.parseAsync(code, {
            parserOpts: {
                plugins: ['typescript', 'jsx'],
                sourceType: 'module'
            }
        });

        // First determine all the server-side exports
        const serverExports: string[] = [];
        await babel.traverse(fullAst, {
            CallExpression(path) {
                const callee = path.get('callee');
                if (callee.isIdentifier() && callee.node.name === 'useQuery') {
                    const firstArg = path.get('arguments')[0];
                    if (!firstArg || !firstArg.isIdentifier()) {
                        throw firstArg.buildCodeFrameError(`The first argument to useQuery() must be an identifier`);
                    }
                    serverExports.push(firstArg.node.name);
                    firstArg.replaceWith(babel.types.stringLiteral(firstArg.node.name));
                }
            }
        });

        const [client, server] = await Promise.all([
            this.buildClientBundle({ serverExports, filePath, fullAst, code }),
            this.buildServerBundle({ fullAst, code })
        ]);
        console.timeEnd('build extension');
        return { client, server };
    }

    static async buildServerBundle({ fullAst, code }: { fullAst: babel.Node; code: string }): Promise<string> {
        const result = await esbuild.build({
            write: false,
            stdin: {
                contents: await this.removeExportsFromAst(fullAst, code, ['Page']),
                sourcefile: 'extension.server.ts',
                loader: 'tsx'
            },
            format: 'cjs',
            platform: 'node',
            target: 'node12',
            bundle: true,
            plugins: [
                {
                    name: 'mark-external-packages',
                    setup(build) {
                        build.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, args => ({
                            path: args.path,
                            external: true
                        }));
                    }
                }
            ]
        });
        return result.outputFiles[0].text;
    }

    static async buildExtensionClient() {
        const result = await esbuild.build({
            entryPoints: [path.resolve(getConfig().serverRuntimeConfig.PROJECT_ROOT, './utils/extension-client.ts')],
            format: 'cjs',
            platform: 'browser',
            target: ['firefox94', 'chrome95'],
            bundle: true,
            write: false
        });
        return result.outputFiles[0].text;
    }

    static async buildClientBundle({
        serverExports,
        fullAst,
        filePath,
        code
    }: {
        serverExports: string[];
        fullAst: babel.Node;
        filePath: string;
        code: string;
    }): Promise<string> {
        const clientCode = await this.removeExportsFromAst(fullAst, code, serverExports);
        const projectPath = await ConfigManager.getProjectPath();
        const result = await esbuild.build({
            write: false,
            stdin: {
                contents: clientCode,
                sourcefile: path.basename(filePath),
                loader: 'tsx'
            },
            platform: 'browser',
            bundle: true,
            absWorkingDir: path.dirname(filePath),
            plugins: [
                {
                    name: 'resolve-sidekick',
                    setup: build => {
                        build.onResolve({ filter: /^sidekick\/client$/ }, args => {
                            return { path: 'sidekick/client', external: false, namespace: 'sidekick' };
                        });
                        build.onLoad({ filter: /^sidekick\/client$/, namespace: 'sidekick' }, async args => {
                            return {
                                contents: await this.buildExtensionClient()
                            };
                        });
                    }
                },
                {
                    name: 'resolve-react',
                    setup: build => {
                        build.onResolve({ filter: /^react$/ }, () => ({
                            path: path.resolve(
                                getConfig().serverRuntimeConfig.PROJECT_ROOT,
                                'node_modules',
                                'react',
                                'index.js'
                            ),
                            external: false
                        }));
                    }
                },
                {
                    name: 'resolve-external',
                    setup: build => {
                        build.onResolve({ filter: /^[^./]/ }, async args => {
                            return {
                                path: await resolveAsync(args.path, {
                                    basedir: projectPath
                                }),
                                external: false
                            };
                        });
                    }
                }
            ]
        });
        return result.outputFiles[0].text;
    }

    static async removeExportsFromAst(inputAst: babel.Node, code: string, exportNames: string[]) {
        const removedExports: string[] = [];
        const { code: outputCode } = await babel.transformFromAstAsync(inputAst, code, {
            plugins: [
                {
                    visitor: {
                        ExportNamedDeclaration(path) {
                            const exports = path.get('declaration');
                            for (const exportDeclaration of Array.isArray(exports) ? exports : [exports]) {
                                switch (exportDeclaration.node.type) {
                                    case 'FunctionDeclaration':
                                        if (
                                            exportDeclaration.node.id.type === 'Identifier' &&
                                            exportNames.includes(exportDeclaration.node.id.name)
                                        ) {
                                            removedExports.push(exportDeclaration.node.id.name);
                                            path.remove();
                                        }
                                        break;

                                    case 'VariableDeclaration':
                                        for (const varDeclaration of exportDeclaration.get('declarations')) {
                                            if (
                                                varDeclaration.node.id.type === 'Identifier' &&
                                                exportNames.includes(varDeclaration.node.id.name)
                                            ) {
                                                removedExports.push(varDeclaration.node.id.name);
                                                path.remove();
                                            }
                                        }
                                        break;

                                    default:
                                        throw path.buildCodeFrameError(`Unexpected export`);
                                }
                            }
                        }
                    }
                }
            ]
        });
        if (removedExports.length !== exportNames.length) {
            throw new Error(`Failed to find exports for: ${exportNames.join(', ')}`);
        }
        return outputCode;
    }
}
