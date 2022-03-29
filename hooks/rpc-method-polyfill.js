// When the frontend imports a file from the API, it actually imports from this file at runtime
module.exports = new Proxy(
	{},
	{
		get(_, methodName) {
			return {
				methodName,
			};
		},
	},
);
