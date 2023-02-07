module.exports = {
	reactStrictMode: true,
	webpack(config, { webpack }) {
		config.plugins.unshift(
			new webpack.NormalModuleReplacementPlugin(
				/.*\/controllers\/.*/,
				(resource) => {
					resource.request = require.resolve('./hooks/rpc-method-polyfill');
				},
			),
		);
		return config;
	},
	typescript: {
		ignoreBuildErrors: true,
	},
	serverRuntimeConfig: {
		__NEXT_SSR_ENV__: 'true',
	},
};
