import { createStreamingRpcMethod } from '../../utils/http';
import { z } from 'zod';

export const getHeartbeat = createStreamingRpcMethod(
	z.object({}),
	async function* (_, abortController) {
		while (!abortController.signal.aborted) {
			yield { isAlive: true };
			await new Promise<void>((resolve) => {
				setTimeout(() => resolve(), 1e3);
			});
		}
	},
);
