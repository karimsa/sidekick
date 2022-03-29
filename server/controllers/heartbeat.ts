import { createStreamingRpcMethod } from '../../utils/http';
import * as t from 'io-ts';

export const getHeartbeat = createStreamingRpcMethod(
	t.interface({}),
	async function* (_, abortController) {
		while (!abortController.signal.aborted) {
			yield { isAlive: true };
			await new Promise<void>((resolve) => {
				setTimeout(() => resolve(), 1e3);
			});
		}
	},
);
