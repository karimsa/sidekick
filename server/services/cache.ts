import * as crypto from 'crypto';
import jsonStableStringify from 'json-stable-stringify';
import * as fs from 'fs';

const isCacheEnabled = process.env.SIDEKICK_CACHE !== 'false';
if (!isCacheEnabled) {
	console.warn(`Sidekick caching is disabled`);
}

export class CacheService {
	private static readonly store: Map<string, { hash: string; value: unknown }> =
		new Map();

	static isEnabled() {
		return isCacheEnabled;
	}

	static hashObject(object: any) {
		return crypto
			.createHash('md5')
			.update(jsonStableStringify(object), 'utf8')
			.digest('hex');
	}

	static async hashFile(filePath: string) {
		return crypto
			.createHash('md5')
			.update(await fs.promises.readFile(filePath))
			.digest('hex');
	}

	static set<T>(key: string, hash: string, value: T) {
		if (!isCacheEnabled) {
			return;
		}

		this.store.delete(key);
		this.store.set(key, {
			hash,
			value,
		});
	}

	static get(key: string, hash: string): unknown | null {
		if (!isCacheEnabled) {
			return null;
		}

		const entry = this.store.get(key);
		if (!entry) {
			return null;
		}
		if (entry.hash !== hash) {
			this.store.delete(key);
			return null;
		}
		return entry.value;
	}
}
