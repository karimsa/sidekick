const { build } = require('esbuild');

const isWatchMode = process.argv.includes('-w');

const buildFile = (input, output) =>
	build({
		entryPoints: [input],
		outfile: output,
		bundle: true,
		platform: 'node',
		target: 'node12',
		define: {
			'process.env.NODE_ENV': JSON.stringify(
				process.env.NODE_ENV || 'development',
			),
		},
		plugins: [
			{
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
			},
		],
		watch: isWatchMode,
	});

Promise.all([
	buildFile('./server/index.ts', './server.dist.js'),
	buildFile('./server/cli.ts', './cli.dist.js'),
]).catch((error) => {
	if (!error.errors) {
		console.error(error);
	}
	process.exit(1);
});
