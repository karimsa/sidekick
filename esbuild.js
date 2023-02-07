const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const isWatchMode = process.argv.includes('-w');

const makeAllPackagesExternal = {
	name: 'make-all-packages-external',
	setup(build) {
		let filter = /^[^./]|^\.[^./]|^\.\.[^/]/;
		build.onResolve({ filter }, (args) => {
			return {
				path: args.path,
				external: true,
			};
		});
	},
};

// Resolve/polyfill the controller imports
const resolveSidekickControllers = {
	name: 'resolve-sidekick-controllers',
	setup: (build) => {
		build.onLoad({ filter: /\/server\/controllers\// }, async (args) => {
			if (
				!args.path.startsWith(path.resolve(__dirname, 'server/controllers'))
			) {
				return;
			}

			const methods = [];
			const ast = babel.parse(await fs.promises.readFile(args.path, 'utf8'), {
				parserOpts: {
					plugins: ['typescript'],
				},
			});
			babel.traverse(ast, {
				ExportNamedDeclaration: (path) => {
					if (path.node.declaration?.type !== 'VariableDeclaration') {
						throw path.buildCodeFrameError(
							`Expected export to be a variable declaration`,
						);
					}
					methods.push(path.node.declaration.declarations[0].id.name);
				},
			});

			return {
				contents: methods
					.map(
						(methodName) =>
							`export const ${methodName} = { methodName: '${methodName}' };`,
					)
					.join('\n'),
			};
		});
	},
};

const buildServerFile = async (input, output, options) => {
	const ctx = await esbuild.context({
		entryPoints: [input],
		outfile: output,
		bundle: true,
		platform: 'node',
		target: 'node12',
		banner: {
			js: '#!/usr/bin/env node\n',
		},
		define: {
			'process.env.NODE_ENV': JSON.stringify(
				process.env.NODE_ENV || 'development',
			),
		},
		plugins: [makeAllPackagesExternal],
		...options,
	});
	await ctx.rebuild();
	if (isWatchMode) {
		await ctx.watch();
	} else {
		await ctx.dispose();
	}
	fs.chmodSync(output, '0755');
};

Promise.all([
	buildServerFile('./server/index.ts', './server.dist.js'),
	buildServerFile('./server/cli/bin.ts', './cli.dist.js'),
	buildServerFile(
		'./server/sidekick-bootstrap.ts',
		'./sidekick-bootstrap.dist.js',
	),
	buildServerFile(
		'./server/upgrade-cli/index.ts',
		'./sidekick-upgrade.dist.js',
	),
	buildServerFile(
		'./extension/index.ts',
		'./extension/extension-helpers.dist.js',
		{
			plugins: [makeAllPackagesExternal, resolveSidekickControllers],
		},
	),
]).catch((error) => {
	if (!error.errors) {
		console.error(error);
	}
	process.exit(1);
});
