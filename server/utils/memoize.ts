export function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
	let err: Error | null = null;
	let lastPromise: Promise<T> | null = null;

	return async function () {
		if (err) {
			throw err;
		}
		if (lastPromise) {
			return lastPromise;
		}

		lastPromise = fn().catch((e) => {
			err = e;
			throw e;
		});
		return lastPromise;
	};
}
