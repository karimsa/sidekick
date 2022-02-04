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

const resolveAsync = util.promisify(resolveModulePath);

export class ExtensionBuilder {
    static async getExtension(extensionPath: string) {
        const projectPath = await ConfigManager.getProjectPath();
        const absPath = path.resolve(projectPath, extensionPath);
        const code = await fs.promises.readFile(absPath, 'utf8');
        return ExtensionBuilder.splitServerClient(absPath, code);
    }

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
            this.buildServerBundle({ fullAst, filePath, code })
        ]);
        console.timeEnd('build extension');
        return { client, server };
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
        const filename = path.basename(filePath);
        const result = await esbuild.build({
            write: false,
            stdin: {
                contents: await this.removeExportsFromAst(fullAst, filename, code, ['Page']),
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
        const clientCode = await this.removeExportsFromAst(fullAst, path.basename(filePath), code, serverExports);
        const projectPath = await ConfigManager.getProjectPath();
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
            plugins: [
                {
                    name: 'resolve-sidekick',
                    setup: build => {
                        build.onResolve({ filter: /^sidekick\/extension$/ }, args => {
                            return { path: 'sidekick/extension', external: false, namespace: 'sidekick' };
                        });
                        build.onLoad({ filter: /^sidekick\/extension$/, namespace: 'sidekick' }, async () => {
                            return {
                                contents: `module.exports = SidekickExtensionHelpers`
                            };
                        });
                    }
                },
                {
                    name: 'resolve-react',
                    setup: build => {
                        build.onResolve({ filter: /^react|react-dom$/ }, args => ({
                            path: args.path,
                            external: true
                        }));
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
                                    basedir: args.resolveDir || projectPath,
                                    extensions: args.resolveDir ? ['.js', '.json'] : ['.ts', '.js', '.json']
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

    static async removeExportsFromAst(inputAst: babel.Node, filename: string, code: string, exportNames: string[]) {
        const removedExports: string[] = [];
        const { code: outputCode } = await babel.transformFromAstAsync(inputAst, code, {
            filename,
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
                },
                babelPluginTransformModules
            ],
            presets: [babelPresetTypescript, babelPresetReact]
        });
        const { code: idktestorsomething } = await minify(outputCode, {
            compress: {
                defaults: false,
                dead_code: true,
                toplevel: true,
                unused: true,
                pure_funcs: ['require']
            },
            mangle: false,
            format: {
                beautify: true
            }
        });
        if (removedExports.length !== exportNames.length) {
            throw new Error(`Failed to find exports for: ${exportNames.join(', ')}`);
        }
        return idktestorsomething;
    }
}
