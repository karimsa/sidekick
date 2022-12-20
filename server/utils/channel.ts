import type { Subscriber } from 'rxjs';
import { Logger } from '../services/logger';

export const CHANNEL_DESTROYED: unique symbol = Symbol(
	'Sidekick channel destroyed',
);
export const CHANNEL_TIMEOUT: unique symbol = Symbol('Sidekick timeout');

type DESTROYED = typeof CHANNEL_DESTROYED;
type TIMEOUT = typeof CHANNEL_TIMEOUT;

const logger = new Logger('channel');

/**
 * This channel implementation deviates from a Go channel in that it only allows for a single
 * consumer to be active at once. Primarily, we use channels with ChannelLists, which allow for
 * each consumer to own its own channel.
 */
export class Channel<T> {
	isDestroyed = false;
	private destructionError?: any;
	private buffer: T[] = [];
	private reader?: {
		resolve: (data: T | DESTROYED | TIMEOUT) => void;
		reject: (error?: any) => void;
	};

	constructor(
		private onDestroy?: (channel: Channel<T>, error?: any) => unknown,
	) {}

	send(data: T) {
		if (this.isDestroyed) {
			throw new Error(`Channel destroyed`);
		}

		if (this.reader) {
			this.reader?.resolve?.(data);
			this.reader = undefined;
		} else {
			this.buffer.push(data);
		}
	}

	async read(timeout?: undefined): Promise<T | DESTROYED>;
	async read(timeout: number): Promise<T | DESTROYED | TIMEOUT>;
	async read(timeout?: number): Promise<T | DESTROYED | TIMEOUT> {
		if (timeout !== undefined && (Number.isNaN(timeout) || timeout <= 0)) {
			throw new Error(`invalid timeout for channel read: ${timeout}`);
		}

		if (this.reader) {
			// There can only be 1 conceptual reader per-channel; if two or more lines
			// of execution are reading from this channel at the same time, their reads
			// will interfere with each other in confusing ways, so we throw this Error
			// here to try to prevent that in the common case.
			throw new Error('tried to read from an unowned channel');
		}

		if (this.isDestroyed) {
			if (this.destructionError) {
				throw this.destructionError;
			}

			return CHANNEL_DESTROYED;
		}

		const nextData = this.buffer.shift();
		if (nextData) {
			return nextData;
		}

		return new Promise<T | DESTROYED | TIMEOUT>((resolve, reject) => {
			if (timeout === undefined) {
				this.reader = { resolve, reject };
				return;
			}

			const timeoutId = setTimeout(() => {
				this.reader = undefined;
				resolve(CHANNEL_TIMEOUT);
			}, timeout);

			const resolveWrapper = (data: T | DESTROYED | TIMEOUT) => {
				clearTimeout(timeoutId);
				resolve(data);
			};

			this.reader = { resolve: resolveWrapper, reject };
		});
	}

	destroy(error?: any): void {
		if (this.isDestroyed) {
			// destroying twice is probably an error; however, we'd then risk some
			// scenario where we try to destroy to clean-up resources and then crash.
			// better to just make sure a call to destroy can only happen once
			logger.info('Destroyed a channel for a second time', {
				error,
				destructionError: this.destructionError,
			});
			return;
		}

		if (error) {
			this.reader?.reject?.(error);
		} else {
			this.reader?.resolve?.(CHANNEL_DESTROYED);
		}

		this.reader = undefined;
		this.buffer.length = 0;
		this.isDestroyed = true;
		this.destructionError = error;

		this.onDestroy?.(this, error);
	}
}

export class ChannelList<T> {
	private readonly channels = new Set<Channel<T>>();

	get size(): number {
		return this.channels.size;
	}

	send(data: T) {
		for (const chan of this.channels) {
			chan.send(data);
		}
	}

	watch() {
		const channel = new Channel<T>((c) => this.channels.delete(c));
		this.channels.add(channel);
		return channel;
	}

	// Watches this channel list and pipes its output to the provided callback.
	// Automatically handles subscriber completion and channel destruction.
	//
	// Note: this function requires a timeout so that you can't get into a situation
	// where the subscriber has closed but the loop is hung on waiting for another event
	// from the channel.
	async watchAndPipeTo(
		subscriber: Subscriber<unknown>,
		timeout: number,
		consumer: (data: T | TIMEOUT) => void,
	): Promise<void> {
		const channel = this.watch();

		while (!subscriber.closed) {
			const resp = await channel.read(timeout);
			if (resp === CHANNEL_DESTROYED) {
				subscriber.complete();
				break;
			}

			consumer(resp);
		}

		channel.destroy();
	}

	destroy() {
		for (const chan of this.channels) {
			chan.destroy();
		}
	}
}
