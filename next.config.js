module.exports = {
	reactStrictMode: true,
	webpack(config, { isServer, webpack }) {
		if (!isServer) {
			config.plugins.unshift(
				new webpack.NormalModuleReplacementPlugin(
					/.*\/controllers\/.*/,
					(resource) => {
						resource.request = require.resolve('./hooks/rpc-method-polyfill');
					},
				),
			);
		}
		return config;
	},
	typescript: {
		ignoreBuildErrors: true,
	},
};
