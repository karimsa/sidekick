import * as babel from '@babel/core';
import * as esbuild from 'esbuild';
import { BuildOptions } from 'esbuild';
import { ConfigManager } from '../services/config';
import resolveModulePath from 'resolve/async';
import * as util from 'util';
import { minify } from 'terser';
import babelPresetTypescript from '@babel/preset-typescript';
import babelPresetReact from '@babel/preset-react';
import babelPluginTransformModules from '@babel/plugin-transform-modules-commonjs';
import createDebug from 'debug';
import EsbuildNodeModulesPolyfill from '@esbuild-plugins/node-modules-polyfill';
import { fmt } from './fmt';
import { ParserOptions } from '@babel/parser';
import { OperationContext } from '@orthly/context';
import * as fs from 'fs';
import * as path from 'path';
import ms from 'ms';

const debug = createDebug('sidekick:extensions');
const verbose = createDebug('sidekick:extensions:verbose');
const resolveAsync = util.promisify(resolveModulePath);

const BabelParserOptions: ParserOptions = {
    plugins: ['typescript', 'jsx'],
    sourceType: 'module'
};

export class ExtensionBuilder {
    static async getExtensionClient(extensionPath: string) {
        const ctx = new OperationContext();
        const timer = ctx.startTimer('build client extension');
        const { code, filePath, fullAst } = await ctx.timePromise(
            'extension rollup',
            this.getRawExtension(ctx, extensionPath)
        );
        ctx.setValues({ filePath });
        const clientCode = await ctx.timePromise(
            'bundle client',
            this.buildClientBundle(ctx, { filePath, fullAst, code })
        );
        timer.end();

        const warnings: string[] = [];

        const bundleSizeMb = Number((clientCode.length / (1024 * 1024)).toFixed(1));
        if (bundleSizeMb > 1 && ctx.getDuration() > 1e3) {
            let bundleWarning = `This extension has produced a ${bundleSizeMb} MB bundle, and took ${ms(
                ctx.getDuration()
            )} to build.`;
            if (!(await this.isMinificationEnabled())) {
                bundleWarning += ` Enabling minification might help reduce bundle size.`;
            }

            warnings.push(bundleWarning);
        }

        return { clientCode, warnings };
    }

    static async getExtensionServer(extensionPath: string) {
        const ctx = new OperationContext();
        const timer = ctx.startTimer('build server extension');
        const { code, filePath, fullAst, serverExports } = await this.getRawExtension(ctx, extensionPath);
        ctx.setValues({ filePath });
        const serverCode = await this.buildServerBundle(ctx, { filePath, fullAst, serverExports, code });
        timer.end();
        return serverCode;
    }

    private static async isMinificationEnabled() {
        const config = await ConfigManager.createProvider();
        return config.getValue('minifyExtensionClients');
    }

    private static createError(ctx: OperationContext, message: string) {
        const error = ctx.createError(message);
        try {
            const debugFile = path.resolve(process.cwd(), `sidekick-error-${new Date().toISOString()}.json`);
            fs.writeFileSync(debugFile, JSON.stringify(ctx.toJSON(), null, '\t'));
            console.log(`Debug information saved in: ${debugFile}`);
        } catch {
            console.error(`Failed to write debug info to file`);
        }
        return error;
    }

    private static async esbuild(_: OperationContext, options: BuildOptions) {
        try {
            return await esbuild.build({
                ...options,
                plugins: [
                    ...options.plugins,
                    {
                        name: 'import-css',
                        setup(build) {
                            build.onLoad({ filter: /\.css$/ }, async args => {
                                const css = await fs.promises.readFile(args.path, 'utf8');
                                return {
                                    contents: `!function(){
                                        try { var d = document.documentElement }
                                        catch (error) { return }

                                        var style = document.createElement('style')
                                        style.setAttribute('data-path', '${args.path}')
                                        style.innerText = ${JSON.stringify(css)}
                                        document.body.appendChild(style)
                                    }()`
                                };
                            });
                        }
                    }
                ],
                logLevel: 'silent',
                write: false
            });
        } catch (error: any) {
            if (error.errors) {
                console.warn(`Build failed with ${error.errors.length} errors`);
                throw error.errors[0].detail || new Error(error.errors[0].text);
            }
            throw error;
        }
    }

    private static async getRawExtension(ctx: OperationContext, extensionPath: string) {
        const projectPath = await ConfigManager.getProjectPath();
        const filePath = path.resolve(projectPath, extensionPath);
        const rawCode = await fs.promises.readFile(filePath, 'utf8');

        const rolledUpCode = await this.rollupExtension(ctx, { filePath, code: rawCode });
        verbose(fmt`Rolled up extension: ${{ filePath, code: rolledUpCode }}`);

        const fullAst = await babel.parseAsync(rolledUpCode, {
            parserOpts: BabelParserOptions
        });

        // First determine all the server-side exports
        const serverExports: string[] = [];
        await babel.traverse(fullAst, {
            CallExpression: path => {
                const callee = path.get('callee');
                // it is possible that esbuild will rename the import, but it'll always be a variation of the original
                if (callee.isIdentifier() && callee.node.name.match(/useQuery|useMutation/)) {
                    const helperBinding = path.scope.getBinding(callee.node.name);
                    if (
                        helperBinding &&
                        helperBinding.path.node.type === 'ImportSpecifier' &&
                        helperBinding.path.parentPath.node.type === 'ImportDeclaration' &&
                        helperBinding.path.parentPath.node.source.value === 'sidekick/extension'
                    ) {
                        const firstArg = path.get('arguments')[0];
                        if (!firstArg || !firstArg.isIdentifier()) {
                            throw this.createError(
                                ctx,
                                `The first argument to ${callee.node.name}() must be an identifier (got ${firstArg.node.type})`
                            );
                        }

                        serverExports.push(firstArg.node.name);
                        firstArg.replaceWith(babel.types.stringLiteral(firstArg.node.name));
                    }
                }
            }
        });
        ctx.setValues({ serverExports });
        debug(fmt`Determined server-side exports: ${serverExports}`);

        return { filePath, fullAst, code: rolledUpCode, serverExports };
    }

    private static async rollupExtension(
        ctx: OperationContext,
        { filePath, code }: { filePath: string; code: string }
    ) {
        const filename = path.basename(filePath);
        const result = await this.esbuild(ctx, {
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

    private static async buildServerBundle(
        ctx: OperationContext,
        {
            fullAst,
            filePath,
            code,
            serverExports
        }: {
            fullAst: babel.Node;
            filePath: string;
            code: string;
            serverExports: string[];
        }
    ): Promise<string> {
        try {
            const filename = path.basename(filePath);
            const serverCode = await this.cleanupExportsFromAst(ctx, {
                ast: fullAst,
                filename,
                code,
                allowedExports: serverExports
            });
            ctx.setValues({ serverCode });
            const result = await this.esbuild(ctx, {
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
                            // since we aren't fully tree-shaking the server bundle, we need to add polyfills
                            // for client-side imports
                            build.onResolve({ filter: /.*/ }, args => ({
                                path: args.path,
                                external: args.path !== 'next/router' && args.path !== 'sidekick/extension',
                                namespace:
                                    args.path !== 'next/router' && args.path !== 'sidekick/extension'
                                        ? undefined
                                        : 'sidekick'
                            }));
                            build.onLoad({ filter: /^(next\/router|sidekick\/extension)$/ }, () => {
                                return { contents: 'module.exports = {}' };
                            });
                        }
                    }
                ]
            });
            return result.outputFiles[0].text;
        } catch (error: any) {
            console.error(error.stack || error);
            throw this.createError(ctx, `Failed to build server bundle: ${error.message || error}`);
        }
    }

    private static async buildClientBundle(
        ctx: OperationContext,
        {
            fullAst,
            filePath,
            code
        }: {
            fullAst: babel.Node;
            filePath: string;
            code: string;
        }
    ): Promise<string> {
        try {
            const clientCode = await ctx.timePromise(
                'cleanup exports',
                this.cleanupExportsFromAst(ctx, {
                    ast: fullAst,
                    filename: path.basename(filePath),
                    code,
                    allowedExports: ['config', 'Page']
                })
            );
            ctx.setValues({ clientCode });

            const minifyExtensionClients = await this.isMinificationEnabled();
            ctx.setValues({ minifyExtensionClients });

            const result = await ctx.timePromise(
                'esbuild',
                this.esbuild(ctx, {
                    write: false,
                    stdin: {
                        contents: clientCode,
                        sourcefile: path.basename(filePath),
                        loader: 'tsx',
                        resolveDir: path.dirname(filePath)
                    },
                    platform: 'browser',
                    target: ['firefox94', 'chrome95'],
                    format: 'cjs',
                    minify: minifyExtensionClients,
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
                                    { filter: /^(react|react-dom|next\/router|sidekick\/extension|tslib)$/ },
                                    args => ({
                                        path: args.path,
                                        external: true
                                    })
                                );
                            }
                        }
                    ]
                })
            );
            return result.outputFiles[0].text;
        } catch (error: any) {
            console.error(error.stack || error);
            throw this.createError(ctx, `Failed to build client bundle: ${error.message || error}`);
        }
    }

    private static async cleanupExportsFromAst(
        ctx: OperationContext,
        {
            ast: inputAst,
            filename,
            code,
            allowedExports
        }: {
            ast: babel.Node;
            filename: string;
            code: string;
            allowedExports: string[];
        }
    ) {
        ctx.setValues({ allowedExports });

        const discoveredExports: string[] = [];
        const injectedExports: string[] = [];
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
                                    if (allowedExports.includes(name)) {
                                        discoveredExports.push(name);
                                    } else {
                                        const binding = specifier.scope.getBinding(name);
                                        if (!binding) {
                                            throw specifier.buildCodeFrameError(
                                                `Cannot find binding for specifier: ${name}`
                                            );
                                        }

                                        // perform removals after retrieving the binding, otherwise the scope gets detached
                                        specifier.remove();
                                        binding.path.remove();
                                    }
                                }

                                return;
                            }

                            const exportDeclaration = path.get('declaration');
                            switch (exportDeclaration.node.type) {
                                case 'FunctionDeclaration':
                                    if (exportDeclaration.node.id.type === 'Identifier') {
                                        if (allowedExports.includes(exportDeclaration.node.id.name)) {
                                            discoveredExports.push(exportDeclaration.node.id.name);
                                        } else {
                                            path.remove();
                                        }
                                    }
                                    break;

                                case 'VariableDeclaration':
                                    for (const varDeclaration of exportDeclaration.node.declarations) {
                                        if (varDeclaration.id.type === 'Identifier') {
                                            if (allowedExports.includes(varDeclaration.id.name)) {
                                                discoveredExports.push(varDeclaration.id.name);
                                            } else {
                                                path.remove();
                                            }
                                        }
                                    }
                                    break;

                                default:
                                    throw path.buildCodeFrameError(`Unexpected export`);
                            }
                        }
                    }
                },
                {
                    visitor: {
                        Program: {
                            exit(path) {
                                ctx.setValues({ discoveredExports });

                                for (const exportId of allowedExports) {
                                    if (!discoveredExports.includes(exportId)) {
                                        const binding = path.scope.getBinding(exportId);
                                        if (!binding) {
                                            throw path.buildCodeFrameError(
                                                `${exportId} was not exported, and cannot be force-exported because a binding was not found`
                                            );
                                        }

                                        injectedExports.push(exportId);
                                        path.pushContainer(
                                            'body',
                                            babel.types.exportNamedDeclaration(null, [
                                                babel.types.exportSpecifier(binding.identifier, binding.identifier)
                                            ])
                                        );
                                    }
                                }
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

        ctx.setValues({ injectedExports, cleanedCode });
        return cleanedCode;
    }
}
