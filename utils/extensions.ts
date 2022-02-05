import * as babel from '@babel/core';
import * as esbuild from 'esbuild';
import * as path from 'path';
import { ConfigManager } from '../services/config';
import resolveModulePath from 'resolve/async';
import * as util from 'util';
import fs from 'fs';
import { builtinModules } from 'module';
import { minify } from 'terser';
import babelPresetTypescript from '@babel/preset-typescript';
import babelPresetReact from '@babel/preset-react';
import babelPluginTransformModules from '@babel/plugin-transform-modules-commonjs';
import createDebug from 'debug';
import ms from 'ms';
import EsbuildNodeModulesPolyfill from '@esbuild-plugins/node-modules-polyfill';
import { fmt } from './fmt';

const debug = createDebug('sidekick:extensions');
const resolveAsync = util.promisify(resolveModulePath);

export class ExtensionBuilder {
    static async getExtensionClient(extensionPath: string) {
        const buildStartTime = Date.now();
        const { serverExports, filePath, fullAst, code } = await this.foo(extensionPath);
        const clientCode = await this.buildClientBundle({ serverExports, filePath, fullAst, code });
        debug(`built client extension ${filePath} in ${ms(Date.now() - buildStartTime)}`);
        return clientCode;
    }

    static async getExtensionServer(extensionPath: string) {
        const buildStartTime = Date.now();
        const { filePath, fullAst, code } = await this.foo(extensionPath);
        const serverCode = await this.buildServerBundle({ filePath, fullAst, code });
        debug(`built server extension ${filePath} in ${ms(Date.now() - buildStartTime)}`);
        return serverCode;
    }

    private static async foo(extensionPath: string) {
        const projectPath = await ConfigManager.getProjectPath();
        const filePath = path.resolve(projectPath, extensionPath);
        const rawCode = await fs.promises.readFile(filePath, 'utf8');

        const rolledUpCode = await this.rollupExtension({ filePath, code: rawCode });
        debug(fmt`Rolled up extension: ${{ filePath, code: rolledUpCode }}`);

        const fullAst = await babel.parseAsync(rolledUpCode, {
            parserOpts: {
                plugins: ['typescript', 'jsx'],
                sourceType: 'module'
            }
        });

        // TODO: Skip this for server bundles
        // First determine all the server-side exports
        const serverExports: string[] = [];
        await babel.traverse(fullAst, {
            CallExpression(path) {
                const callee = path.get('callee');
                if (callee.isIdentifier() && (callee.node.name === 'useQuery' || callee.node.name === 'useMutation')) {
                    const firstArg = path.get('arguments')[0];
                    if (!firstArg || !firstArg.isIdentifier()) {
                        throw firstArg.buildCodeFrameError(
                            `The first argument to ${callee.node.name}() must be an identifier`
                        );
                    }

                    const helperBinding = path.scope.getBinding(callee.node.name);
                    if (
                        helperBinding &&
                        helperBinding.path.node.type === 'ImportSpecifier' &&
                        helperBinding.path.parentPath.node.type === 'ImportDeclaration' &&
                        helperBinding.path.parentPath.node.source.value === 'sidekick/extension'
                    ) {
                        serverExports.push(firstArg.node.name);
                        firstArg.replaceWith(babel.types.stringLiteral(firstArg.node.name));
                    } else {
                        throw path.buildCodeFrameError(
                            `Failed to find ${callee.node.name} imported from sidekick/extension`
                        );
                    }
                }
            }
        });

        return {
            serverExports,
            fullAst,
            code: rolledUpCode,
            filePath
        };
    }

    private static async rollupExtension({ filePath, code }: { filePath: string; code: string }) {
        const filename = path.basename(filePath);
        const result = await esbuild.build({
            write: false,
            stdin: {
                contents: code,
                sourcefile: filename,
                loader: 'tsx'
            },
            format: 'esm',
            platform: 'neutral',
            target: 'es2020',
            bundle: true,
            plugins: [
                {
                    name: 'resolve-external',
                    setup(build) {
                        build.onResolve({ filter: /^[^./]/ }, args => ({
                            path: args.path,
                            external: true
                        }));
                    }
                },
                {
                    name: 'resolve-internal',
                    setup: build => {
                        build.onResolve({ filter: /^[./]/ }, async args => {
                            return {
                                path: await resolveAsync(args.path, {
                                    basedir: args.resolveDir || path.dirname(filePath),
                                    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
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

    static async buildServerBundle({
        fullAst,
        filePath,
        code
    }: {
        fullAst: babel.Node;
        filePath: string;
        code: string;
    }): Promise<string> {
        try {
            const filename = path.basename(filePath);
            const serverCode = await this.removeExportsFromAst(fullAst, filename, code, ['Page']);
            debug({ filePath, serverCode });
            const result = await esbuild.build({
                write: false,
                stdin: {
                    contents: serverCode,
                    sourcefile: filename,
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
                                external: args.path !== 'next/router' && args.path !== 'sidekick/extension',
                                namespace:
                                    args.path !== 'next/router' && args.path !== 'sidekick/extension'
                                        ? undefined
                                        : 'sidekick'
                            }));
                            build.onLoad({ filter: /^(next\/router|sidekick\/extension)$/ }, args => {
                                return { contents: 'module.exports = {}' };
                            });
                        }
                    },
                    {
                        name: 'resolve-internal',
                        setup: build => {
                            build.onResolve({ filter: /^[./]/ }, async args => {
                                return {
                                    path: await resolveAsync(args.path, {
                                        basedir: args.resolveDir || path.dirname(filePath),
                                        extensions: ['.ts', '.js', '.json']
                                    }),
                                    external: false
                                };
                            });
                        }
                    }
                ]
            });
            return result.outputFiles[0].text;
        } catch (error: any) {
            console.error(error.stack || error);
            throw new Error(`Failed to build server bundle: ${error.message || error}`);
        }
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
        try {
            const clientCode = await this.removeExportsFromAst(fullAst, path.basename(filePath), code, serverExports);
            debug({ filePath, clientCode });
            const result = await esbuild.build({
                write: false,
                stdin: {
                    contents: clientCode,
                    sourcefile: path.basename(filePath),
                    loader: 'tsx'
                },
                platform: 'browser',
                target: ['firefox94', 'chrome95'],
                format: 'cjs',
                // minify: true,
                bundle: true,
                absWorkingDir: path.dirname(filePath),
                loader: {
                    '.png': 'base64',
                    '.jpg': 'base64',
                    '.jpeg': 'base64'
                },
                define: {
                    'process.env': JSON.stringify(process.env)
                },
                plugins: [
                    EsbuildNodeModulesPolyfill(),
                    {
                        name: 'resolve-sidekick-packages',
                        setup: build => {
                            build.onResolve(
                                { filter: /^(react|react-dom|next\/router|sidekick\/extension)$/ },
                                args => ({
                                    path: args.path,
                                    external: true
                                })
                            );
                        }
                    },
                    {
                        name: 'resolve-external',
                        setup: build => {
                            build.onResolve({ filter: /.*/ }, async args => {
                                if (builtinModules.includes(args.path)) {
                                    return { path: args.path, external: true };
                                }

                                return {
                                    path: await resolveAsync(args.path, {
                                        basedir: args.resolveDir || path.dirname(filePath),
                                        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
                                    }),
                                    external: false
                                };
                            });
                        }
                    }
                ]
            });
            return result.outputFiles[0].text;
        } catch (error: any) {
            console.error(error.stack || error);
            throw new Error(`Failed to build client bundle: ${error.message || error}`);
        }
    }

    static async removeExportsFromAst(inputAst: babel.Node, filename: string, code: string, exportNames: string[]) {
        const removedExports: string[] = [];
        const { code: exportsRemovedCode } = await babel.transformFromAstAsync(inputAst, code, {
            filename,
            plugins: [
                {
                    visitor: {
                        ExportNamedDeclaration(path) {
                            if (!path.node.declaration) {
                                if (path.node.source) {
                                    throw path.buildCodeFrameError(`Cannot re-export files from other modules`);
                                }

                                for (const specifier of path.get('specifiers')) {
                                    if (specifier.node.type === 'ExportDefaultSpecifier') {
                                        throw path.buildCodeFrameError(`default exports are not supported`);
                                    }
                                    if (specifier.node.type === 'ExportNamespaceSpecifier') {
                                        throw path.buildCodeFrameError(`ESM namespaces are not supported`);
                                    }

                                    const name = specifier.node.local.name;
                                    if (exportNames.includes(name)) {
                                        const binding = specifier.scope.getBinding(name);
                                        if (!binding) {
                                            throw specifier.buildCodeFrameError(
                                                `Cannot find binding for specifier: ${name}`
                                            );
                                        }

                                        // perform removals after retrieving the binding, otherwise the scope gets detached
                                        specifier.remove();
                                        binding.path.remove();
                                        removedExports.push(name);
                                    }
                                }

                                return;
                            }

                            const exportDeclaration = path.get('declaration');
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
                                    for (const varDeclaration of exportDeclaration.node.declarations) {
                                        if (
                                            varDeclaration.id.type === 'Identifier' &&
                                            exportNames.includes(varDeclaration.id.name)
                                        ) {
                                            removedExports.push(varDeclaration.id.name);
                                            path.remove();
                                        }
                                    }
                                    break;

                                default:
                                    throw path.buildCodeFrameError(`Unexpected export`);
                            }
                        }
                    }
                },
                babelPluginTransformModules
            ],
            presets: [babelPresetTypescript, babelPresetReact]
        });
        const { code: cleanedCode } = await minify(exportsRemovedCode, {
            compress: {
                defaults: false,
                dead_code: true,
                toplevel: true,
                unused: true,
                pure_funcs: [
                    'require',

                    // babel internal helpers
                    // Source: https://github.com/babel/babel/blob/a6d77d07b461064deda6bdae308a0c70cacdd280/packages/babel-helpers/src/helpers.ts
                    '_interopRequireWildcard',
                    '_interopRequireDefault'
                ],
                unsafe: true
            },
            mangle: false,
            format: {
                beautify: true
            }
        });
        if (removedExports.length !== exportNames.length) {
            throw new Error(
                `Failed to find exports for: ${exportNames.filter(name => !removedExports.includes(name)).join(', ')}`
            );
        }
        return cleanedCode;
    }
}
