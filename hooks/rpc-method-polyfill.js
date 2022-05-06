const polyfillCache = new Map();

// When the frontend imports a file from the API, it actually imports from this file at runtime
module.exports = new Proxy(
	{},
	{
		get(_, methodName) {
			// Need to cache the object we return, to avoid unnecessary re-renders in react
			const cached = polyfillCache.get(methodName);
			if (cached) {
				return cached;
			}

			const newInstance = {
				methodName,
			};
			polyfillCache.set(methodName, newInstance);
			return newInstance;
		},
	},
);
