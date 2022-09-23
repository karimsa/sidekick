const { build } = require('esbuild');

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

const buildServerFile = (input, output) =>
	build({
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
		watch: isWatchMode,
	});

Promise.all([
	buildServerFile('./server/index.ts', './server.dist.js'),
	buildServerFile('./server/cli/index.ts', './cli.dist.js'),
]).catch((error) => {
	if (!error.errors) {
		console.error(error);
	}
	process.exit(1);
});
