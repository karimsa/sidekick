import { createStreamingRpcMethod } from '../../utils/http';
import { z } from 'zod';

export const getHeartbeat = createStreamingRpcMethod(
	z.object({}),
	async (_, subscriber) => {
		while (!subscriber.closed) {
			subscriber.next({ isAlive: true });
			await new Promise<void>((resolve) => {
				setTimeout(() => resolve(), 1e3);
			});
		}
	},
);
