import * as babel from '@babel/core';
import type { ParserOptions } from '@babel/parser';
import * as esbuild from 'esbuild';
import { BuildOptions } from 'esbuild';
// @ts-ignore
import resolveModulePath from 'resolve/async';
import { minify } from 'terser';
import * as util from 'util';
// @ts-ignore
import babelPresetTypescript from '@babel/preset-typescript';
// @ts-ignore
import babelPresetReact from '@babel/preset-react';
// @ts-ignore
import babelPluginTransformModules from '@babel/plugin-transform-modules-commonjs';
import EsbuildNodeModulesPolyfill from '@esbuild-plugins/node-modules-polyfill';
import { OperationContext } from '@orthly/context';
import Express from 'express';
import * as fs from 'fs';
import ms from 'ms';
import * as path from 'path';

import { rpcMethods } from '../index';
import { CacheService } from '../services/cache';
import { ConfigManager, SidekickExtensionConfig } from '../services/config';
import { Logger } from '../services/logger';
import { NO_RESPONSE, route } from './http';

const logger = new Logger('extensions');
const resolveAsync = util.promisify(resolveModulePath);

const BabelParserOptions: ParserOptions = {
	plugins: ['typescript', 'jsx'],
	sourceType: 'module',
};

interface ClientResult {
	warnings: string[];
	clientCode: string;
}

export function setupExtensionEndpoints(app: Express.Router) {
	app.use(
		'/extension/:extensionId/renderer',
		route(async (req, res) => {
			const { extensionId } = req.params;
			const config = await ConfigManager.loadProjectOverrides();
			const extension = config.extensions?.find(
				(ext) => ext.id === extensionId,
			);
			if (!extension) {
				throw new Error(`Extension with id '${extensionId}' not found`);
			}

			res.end(
				[
					`<!doctype html>`,
					`<html>`,
					`<head>`,
					`<title>${extension.name}</title>`,
					`</head>`,

					`<body>`,

					`<div id="app"></div>`,
					`<script src="/extension/${extensionId}/bootstrap.js"></script>`,
					`</body>`,
					`</html>`,
				].join(''),
			);
			return NO_RESPONSE;
		}),
	);
	app.head('/extension/:extensionId/bootstrap.js', async (req, res) => {
		try {
			const { extensionId } = req.params;
			const config = await ConfigManager.loadProjectOverrides();
			const extension = config.extensions?.find(
				(ext) => ext.id === extensionId,
			);
			if (!extension) {
				throw new Error(`Extension with id '${extensionId}' not found`);
			}

			res.setHeader(
				'ETag',
				await ExtensionBuilder.getExtensionClientHash(extension),
			);
		} catch (err) {
			res.status(500);
			res.end(String(err));
		}
	});
	app.get('/extension/:extensionId/bootstrap.js', async (req, res) => {
		const logger = new Logger('extensions');

		try {
			const { extensionId } = req.params;
			const config = await ConfigManager.loadProjectOverrides();
			const extension = config.extensions?.find(
				(ext) => ext.id === extensionId,
			);
			if (!extension) {
				throw new Error(`Extension with id '${extensionId}' not found`);
			}

			const etag = await ExtensionBuilder.getExtensionClientHash(extension);
			res.setHeader('ETag', etag);

			if (CacheService.isEnabled() && req.headers['if-none-match'] === etag) {
				res.status(304);
				res.end();
				return;
			}

			const { clientCode } = await ExtensionBuilder.getExtensionClient(
				extension,
			);
			res.contentType('application/javascript');
			res.end(clientCode);
		} catch (err) {
			logger.error(`Failed to build extension bootstrap`, {
				err,
			});

			res.end(
				`window.parent.postMessage(${JSON.stringify({
					type: 'buildFailed',
					message: String((err as Error).message ?? err).split('\n')[0],
					stack: String((err as Error).stack ?? err),
					cause: (err as Error).cause ? String((err as Error).cause) : null,
				})}, '*')`,
			);
		}
	});
}

export class ExtensionBuilder {
	static async getExtensionClientHash({
		entryPoint: extensionPath,
	}: SidekickExtensionConfig) {
		const ctx = new OperationContext();
		const { code } = await ctx.timePromise(
			'extension rollup',
			this.getRawExtension(ctx, extensionPath),
		);
		return CacheService.hashObject({
			code,
		});
	}

	static async getExtensionClient({
		id: extensionId,
		entryPoint: extensionPath,
	}: SidekickExtensionConfig) {
		const ctx = new OperationContext();
		const timer = ctx.startTimer('build client extension');
		const { code, filePath, fullAst } = await ctx.timePromise(
			'extension rollup',
			this.getRawExtension(ctx, extensionPath),
		);
		ctx.setValues({ filePath });

		const cacheEntry = await CacheService.get(
			`extension-client-${extensionId}`,
			CacheService.hashObject({
				code,
			}),
		);
		if (cacheEntry) {
			logger.debug(`Cache hit for extension client`, { extensionId });
			return cacheEntry as ClientResult;
		}
		logger.debug(`Cache miss for extension client`, { extensionId });

		const clientCode = await ctx.timePromise(
			'bundle client',
			this.buildClientBundle(ctx, { extensionId, filePath, fullAst, code }),
		);
		timer.end();

		const warnings: string[] = [];

		const bundleSizeMb = Number((clientCode.length / (1024 * 1024)).toFixed(1));
		if (bundleSizeMb > 1 && ctx.getDuration() > 1e3) {
			let bundleWarning = `This extension has produced a ${bundleSizeMb} MB bundle, and took ${ms(
				ctx.getDuration(),
			)} to build.`;
			if (!(await this.isMinificationEnabled())) {
				bundleWarning += ` Enabling minification might help reduce bundle size.`;
			}

			warnings.push(bundleWarning);
		}

		await CacheService.set(
			`extension-client-${extensionId}`,
			CacheService.hashObject({
				code,
			}),
			{ clientCode, warnings },
		);
		return { clientCode, warnings };
	}

	static async getExtensionServer({
		id: extensionId,
		entryPoint: extensionPath,
	}: SidekickExtensionConfig) {
		const ctx = new OperationContext();
		const timer = ctx.startTimer('build server extension');
		const { code, filePath, fullAst, serverExports } =
			await this.getRawExtension(ctx, extensionPath);
		ctx.setValues({ filePath });

		const cacheEntry = await CacheService.get(
			`extension-server-${extensionId}`,
			CacheService.hashObject({
				code,
			}),
		);
		if (cacheEntry) {
			logger.debug(`Cache hit for extension server`, { extensionId });
			return cacheEntry;
		}
		logger.debug(`Cache miss for extension server`, { extensionId });

		const serverCode = await this.buildServerBundle(ctx, {
			filePath,
			fullAst,
			serverExports,
			code,
		});
		timer.end();

		await CacheService.set(
			`extension-server-${extensionId}`,
			CacheService.hashObject({
				code,
			}),
			serverCode,
		);
		return serverCode;
	}

	private static async isMinificationEnabled() {
		const config = await ConfigManager.createProvider();
		return config.getValue('minifyExtensionClients');
	}

	private static createError(ctx: OperationContext, message: string) {
		const error = ctx.createError(message);
		try {
			const debugFile = path.resolve(
				process.cwd(),
				`sidekick-error-${new Date().toISOString()}.json`,
			);
			fs.writeFileSync(debugFile, JSON.stringify(ctx.toJSON(), null, '\t'));
			console.log(`Debug information saved in: ${debugFile}`);
		} catch {
			console.error(`Failed to write debug info to file`);
		}
		return error;
	}

	private static async esbuild(
		_: OperationContext,
		options: Omit<BuildOptions, 'plugins'> &
			Required<Pick<BuildOptions, 'plugins'>>,
	) {
		try {
			return await esbuild.build({
				...options,
				plugins: [
					...options.plugins,
					{
						name: 'import-css',
						setup(build) {
							build.onLoad({ filter: /\.css$/ }, async (args) => {
								const css = await fs.promises.readFile(args.path, 'utf8');
								return {
									contents: `!function(){
											try { var d = document.documentElement }
											catch (error) { return }

											var style = document.createElement('style')
											style.setAttribute('data-path', '${args.path}')
											style.innerText = ${JSON.stringify(css)}
											document.body.appendChild(style)
									}()`,
								};
							});
						},
					},
				],
				logLevel: 'silent',
				write: false,
			});
		} catch (error: any) {
			if (error.errors) {
				logger.error(`Build failed`, {
					errors: error.errors,
				});
				throw error.errors[0].detail || new Error(error.errors[0].text);
			}
			throw error;
		}
	}

	static async getRawExtension(ctx: OperationContext, extensionPath: string) {
		const projectPath = await ConfigManager.getProjectPath();
		const filePath = path.resolve(projectPath, extensionPath);
		const rawCode = await fs.promises.readFile(filePath, 'utf8');

		const rolledUpCode = await ctx.timePromise(
			'rollupExtension',
			this.rollupExtension(ctx, {
				filePath,
				code: rawCode,
			}),
		);
		logger.debug(`Rolled up extension`, {
			filePath,
			codeLength: rolledUpCode.length,
		});

		const fullAst = (await ctx.timePromise(
			'parse code',
			babel.parseAsync(rolledUpCode, {
				parserOpts: BabelParserOptions,
			} as any),
		))!;

		// First determine all the server-side exports
		const serverExports: string[] = [];
		const timer = ctx.startTimer('find server side exports');
		await babel.traverse(fullAst, {
			CallExpression: (path) => {
				const callee = path.get('callee');
				// it is possible that esbuild will rename the import, but it'll always be a variation of the original
				if (
					callee.isIdentifier() &&
					callee.node.name.match(/useQuery|useMutation/)
				) {
					const helperBinding = path.scope.getBinding(callee.node.name);
					if (
						helperBinding &&
						helperBinding.path.node.type === 'ImportSpecifier' &&
						helperBinding.path.parentPath?.node.type === 'ImportDeclaration' &&
						helperBinding.path.parentPath?.node.source.value ===
							'@karimsa/sidekick/extension'
					) {
						const firstArg = path.get('arguments')[0];
						if (!firstArg || !firstArg.isIdentifier()) {
							throw this.createError(
								ctx,
								`The first argument to ${callee.node.name}() must be an identifier (got ${firstArg.node.type})`,
							);
						}

						serverExports.push(firstArg.node.name);
						firstArg.replaceWith(babel.types.stringLiteral(firstArg.node.name));
					}
				}
			},
		});
		timer.end();
		ctx.setValues({ serverExports });
		logger.debug(`Determined server-side exports`, { serverExports });

		return { filePath, fullAst, code: rolledUpCode, serverExports };
	}

	private static async rollupExtension(
		ctx: OperationContext,
		{ filePath, code }: { filePath: string; code: string },
	) {
		const filename = path.basename(filePath);
		const result = await this.esbuild(ctx, {
			write: false,
			stdin: {
				contents: code,
				sourcefile: filename,
				loader: 'tsx',
			},
			format: 'esm',
			platform: 'neutral',
			target: 'es2020',
			bundle: true,
			plugins: [
				{
					name: 'resolve-external',
					setup(build) {
						build.onResolve({ filter: /^[^./]/ }, (args) => ({
							path: args.path,
							external: true,
						}));
					},
				},
				{
					name: 'resolve-internal',
					setup: (build) => {
						build.onResolve({ filter: /^[./]/ }, async (args) => {
							const basedir = args.resolveDir || path.dirname(filePath);

							try {
								return {
									path: await resolveAsync(args.path, {
										basedir,
										extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
									}),
									external: false,
								};
							} catch (err) {
								throw Object.assign(
									new Error(
										`Failed to resolve '${args.path}' from '${basedir}' (requested by '${args.importer}')`,
									),
									{
										args,
										plugin: 'resolve-internal',
									},
								);
							}
						});
					},
				},
			],
		});
		return result.outputFiles[0].text;
	}

	private static async buildServerBundle(
		ctx: OperationContext,
		{
			fullAst,
			filePath,
			code,
			serverExports,
		}: {
			fullAst: babel.Node;
			filePath: string;
			code: string;
			serverExports: string[];
		},
	): Promise<string> {
		try {
			const filename = path.basename(filePath);
			const serverCode = await this.cleanupExportsFromAst(ctx, {
				ast: fullAst,
				filename,
				code,
				allowedExports: serverExports,
			});
			ctx.setValues({ serverCode });
			const result = await this.esbuild(ctx, {
				write: false,
				stdin: {
					contents: serverCode,
					sourcefile: filename,
					loader: 'tsx',
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
							build.onResolve({ filter: /.*/ }, (args) => ({
								path: args.path,
								external:
									args.path !== 'next/router' &&
									args.path !== '@karimsa/sidekick/extension',
								namespace:
									args.path !== 'next/router' &&
									args.path !== '@karimsa/sidekick/extension'
										? undefined
										: 'sidekick',
							}));
							build.onLoad(
								{ filter: /^(next\/router|@karimsa\/sidekick\/extension)$/ },
								() => {
									return { contents: 'module.exports = {}' };
								},
							);
						},
					},
				],
			});
			return result.outputFiles[0].text;
		} catch (error: any) {
			console.error(error.stack || error);
			throw this.createError(
				ctx,
				`Failed to build server bundle: ${error.message || error}`,
			);
		}
	}

	private static async buildClientBundle(
		ctx: OperationContext,
		{
			extensionId,
			fullAst,
			filePath,
			code,
		}: {
			extensionId: string;
			fullAst: babel.Node;
			filePath: string;
			code: string;
		},
	): Promise<string> {
		const { extensions } = await ConfigManager.loadProjectOverrides();
		const extensionConfig = extensions?.find((e) => e.id === extensionId);
		if (!extensionConfig) {
			throw new Error(`Extension not found: ${extensionId}`);
		}

		const clientCode = await ctx.timePromise(
			'cleanup exports',
			this.cleanupExportsFromAst(ctx, {
				ast: fullAst,
				filename: path.basename(filePath),
				code,
				allowedExports: ['Page'],
			}),
		);
		ctx.setValues({ clientCode });

		const minifyExtensionClients = await this.isMinificationEnabled();
		ctx.setValues({ minifyExtensionClients });

		const result = await ctx.timePromise(
			'esbuild',
			this.esbuild(ctx, {
				write: false,
				stdin: {
					contents: await fs.promises.readFile(
						path.resolve(__dirname, './extension/bootstrap.tsx'),
						'utf8',
					),
					loader: 'tsx',
					sourcefile: `_sidekick.bootstrap.ts`,
					resolveDir: path.dirname(filePath),
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
					'.jpeg': 'base64',
				},
				define: {
					'process.env': JSON.stringify(process.env),
					process: 'undefined',
				},
				plugins: [
					EsbuildNodeModulesPolyfill(),

					{
						name: 'resolve-missing-polyfills',
						setup(build) {
							build.onResolve({ filter: /^worker_threads$/ }, (args) => ({
								path: args.path,
								external: true,
								pluginData: {
									...args,
									resolvedByPlugin: 'resolve-missing-polyfills',
								},
							}));
						},
					},

					{
						name: 'generate-extension-config',
						setup: (build) => {
							build.onResolve(
								{
									filter: /^sidekick-extension-config$/,
								},
								(args) => ({
									path: args.path,
									namespace: 'sidekick-extension-config',
									pluginData: {
										...args,
										resolvedByPlugin: 'generate-extension-config',
									},
								}),
							);
							build.onLoad(
								{ filter: /./, namespace: 'sidekick-extension-config' },
								async () => ({
									contents: `export const config = ${JSON.stringify(
										extensionConfig,
									)}`,
								}),
							);
						},
					},

					{
						name: 'import-sidekick-extension-code',
						setup: (build) => {
							build.onResolve({ filter: /^sidekick-extension-code$/ }, () => ({
								path: filePath,
								namespace: 'sidekick-extension-code',
							}));
							build.onLoad(
								{ filter: /./, namespace: 'sidekick-extension-code' },
								(args) => {
									if (args.path !== filePath) {
										return {};
									}

									return {
										contents: clientCode,
										resolveDir: path.dirname(filePath),
									};
								},
							);
						},
					},

					// Resolve/polyfill the controller imports
					{
						name: 'resolve-sidekick-controllers',
						setup: (build) => {
							build.onResolve({ filter: /\/server\/controllers\// }, (args) => {
								if (
									!args.importer.startsWith(__dirname) ||
									args.importer.includes('/node_modules/')
								) {
									return {};
								}
								return {
									path: path.resolve(
										__dirname,
										'./hooks/rpc-method-polyfill.js',
									),
									namespace: 'sidekick-controller',
								};
							});
							build.onLoad(
								{ filter: /./, namespace: 'sidekick-controller' },
								async () => ({
									contents: [
										`module.exports = {`,
										...Object.keys(rpcMethods).map(
											(key) => `\t${key}: { methodName: "${key}" },`,
										),
										`}`,
									].join('\n'),
								}),
							);
						},
					},

					// Resolve extension helpers
					{
						name: 'resolve-sidekick-extension-helpers',
						setup: (build) => {
							build.onResolve(
								{
									filter: /^@karimsa\/sidekick\/extension$/,
								},
								() => ({
									path: path.resolve(__dirname, './extension/index.ts'),
									namespace: 'sidekick-extension-helpers',
								}),
							);
							build.onLoad(
								{ filter: /./, namespace: 'sidekick-extension-helpers' },
								async (args) => ({
									loader: 'tsx',
									contents: await fs.promises.readFile(args.path, 'utf8'),

									// We cannot set the 'resolveDir', because this is a virtual file
									// so we need to manually resolve the imports in later plugins
								}),
							);
						},
					},

					// Resolve package imports relative to the extension
					{
						name: 'resolve-extension-imported-packages',
						setup(build) {
							build.onResolve({ filter: /^[^.]/ }, async (args) => {
								const isImportFromSidekick =
									args.importer.startsWith(__dirname);
								const isPeerDependency = [
									'react',
									'react-dom',
									'react-query',
								].includes(args.path);

								// If the import is coming from sidekick, there's some modules that we
								// want to allow resolving relative to the extension, but the rest we
								// want to keep resolving relative to sidekick
								const basedir =
									!isImportFromSidekick || isPeerDependency
										? path.dirname(filePath)
										: args.resolveDir || __dirname;

								try {
									return {
										path: await resolveAsync(args.path, {
											basedir,
											extensions: ['.js', '.json'],
										}),
										pluginData: {
											...args,
											resolvedByPlugin: 'resolve-extension-imported-packages',
										},
									};
								} catch (err) {
									throw Object.assign(
										new Error(
											`Failed to resolve '${args.path}' from '${basedir}' (requested by '${args.importer}')`,
										),
										{
											args,
											plugin: 'resolve-extension-imported-packages',
										},
									);
								}
							});
						},
					},

					// Resolve internal imports relative to sidekick
					{
						name: 'resolve-sidekick-internal-imports',
						setup(build) {
							build.onResolve(
								{
									filter: /^\./,
								},
								async (args) => {
									if (
										args.importer.startsWith(__dirname) &&
										!args.importer.includes('/node_modules/')
									) {
										try {
											return {
												path: await resolveAsync(args.path, {
													basedir:
														args.namespace === 'sidekick-extension-helpers'
															? path.dirname(args.importer)
															: args.resolveDir || path.dirname(args.importer),
													extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
												}),
												pluginData: {
													...args,
													resolvedByPlugin: 'resolve-sidekick-internal-imports',
												},
											};
										} catch (err) {
											throw Object.assign(
												new Error(
													`Failed to resolve '${
														args.path
													}' from '${path.dirname(
														args.importer,
													)}' (requested by '${args.importer}')`,
												),
												{
													args,
													plugin: 'resolve-sidekick-internal-imports',
												},
											);
										}
									}
								},
							);
						},
					},
				],
				metafile: true,
			}),
		);

		const resultCode = result.outputFiles[0].text;
		logger.info(`Extension client built`, {
			metrics: ctx.toJSON().metrics,
			compiledSize: resultCode.length,
		});
		return resultCode;
	}

	private static async cleanupExportsFromAst(
		ctx: OperationContext,
		{
			ast: inputAst,
			filename,
			code,
			allowedExports,
		}: {
			ast: babel.Node;
			filename: string;
			code: string;
			allowedExports: string[];
		},
	) {
		ctx.setValues({ allowedExports });

		const shouldMinify = await this.isMinificationEnabled();
		const discoveredExports: string[] = [];
		const injectedExports: string[] = [];
		const { code: exportsRemovedCode } = (await ctx.timePromise(
			'remove exports from code',
			babel.transformFromAstAsync(inputAst, code, {
				filename,
				plugins: [
					{
						visitor: {
							ExportNamedDeclaration(path) {
								if (!path.node.declaration) {
									if (path.node.source) {
										throw path.buildCodeFrameError(
											`Cannot re-export files from other modules`,
										);
									}

									for (const specifier of path.get('specifiers')) {
										if (specifier.node.type === 'ExportDefaultSpecifier') {
											throw path.buildCodeFrameError(
												`default exports are not supported`,
											);
										}
										if (specifier.node.type === 'ExportNamespaceSpecifier') {
											throw path.buildCodeFrameError(
												`ESM namespaces are not supported`,
											);
										}

										const name = specifier.node.local.name;
										if (allowedExports.includes(name)) {
											discoveredExports.push(name);
										} else {
											const binding = specifier.scope.getBinding(name);
											if (!binding) {
												throw specifier.buildCodeFrameError(
													`Cannot find binding for specifier: ${name}`,
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
								switch (exportDeclaration.node?.type) {
									case 'FunctionDeclaration':
										if (exportDeclaration.node?.id?.type === 'Identifier') {
											if (
												allowedExports.includes(exportDeclaration.node.id.name)
											) {
												discoveredExports.push(exportDeclaration.node.id.name);
											} else {
												path.remove();
											}
										}
										break;

									case 'VariableDeclaration':
										for (const varDeclaration of exportDeclaration.node
											.declarations) {
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
							},
						},
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
													`${exportId} was not exported, and cannot be force-exported because a binding was not found`,
												);
											}

											injectedExports.push(exportId);
											path.pushContainer(
												'body',
												babel.types.exportNamedDeclaration(null, [
													babel.types.exportSpecifier(
														binding.identifier,
														binding.identifier,
													),
												]),
											);
										}
									}
								},
							},
						},
					},
					babelPluginTransformModules,
				],
				presets: [babelPresetTypescript, babelPresetReact],
				compact: !shouldMinify,
			}),
		))!;
		const { code: cleanedCode } = await ctx.timePromise(
			'remove dead code',
			minify(exportsRemovedCode!, {
				compress: {
					defaults: false,
					dead_code: true,
					toplevel: true,
					unused: true,
					pure_funcs: [
						'require',

						// esbuild rewrites require -> __require
						'__require',

						// babel internal helpers
						// Source: https://github.com/babel/babel/blob/a6d77d07b461064deda6bdae308a0c70cacdd280/packages/babel-helpers/src/helpers.ts
						'_interopRequireWildcard',
						'_interopRequireDefault',
					],
					unsafe: true,
				},
				mangle: shouldMinify,
				format: {
					beautify: !shouldMinify,
				},
			}),
		);

		ctx.setValues({ injectedExports, cleanedCode });
		return cleanedCode!;
	}
}
