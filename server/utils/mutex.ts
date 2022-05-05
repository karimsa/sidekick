import * as uuid from 'uuid';
import { Logger } from '../services/logger';

const logger = new Logger('mux');

export class Mutex {
	private static readonly mutexState = new Map<
		string,
		{ id: string; expiration: number; waiters: (() => void)[] }
	>();

	private static acquire(name: string, timeout: number) {
		const id = uuid.v4();
		return new Promise<() => Promise<void>>((resolve) => {
			const state = this.mutexState.get(name);
			if (state && Date.now() < Number(state?.expiration)) {
				logger.debug(`mux unavailable, will wait`, { name });
				state.waiters.push(() => {
					console.log(`mux ${name} acquired (late)`);
					this.mutexState.set(name, {
						id,
						expiration: Date.now() + timeout,
						waiters: [],
					});
					resolve(() => this.release(name, id));
				});
			} else {
				logger.debug(`mux acquired`, { name });
				this.mutexState.set(name, {
					id,
					expiration: Date.now() + timeout,
					waiters: [],
				});
				resolve(() => this.release(name, id));
			}
		});
	}

	private static async release(name: string, id: string) {
		logger.debug(`mux released`, { name });
		const state = this.mutexState.get(name);
		if (state?.id !== id && Date.now() < Number(state?.expiration)) {
			throw new Error(`Cannot release mutex that has been taken`);
		}
		const nextWaiter = state?.waiters.shift();
		if (nextWaiter) {
			logger.debug(`mux passing`, { name });
			nextWaiter();
			return;
		}
		logger.debug(`mux deleting`, { name });
		this.mutexState.delete(name);
	}

	static async withMutex(
		name: string,
		timeout: number,
		fn: () => Promise<void>,
	) {
		const release = await this.acquire(name, timeout);
		try {
			await fn();
		} finally {
			await release();
		}
	}
}
