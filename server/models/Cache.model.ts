import { Model } from '../utils/Model';
import { z } from 'zod';
import * as crypto from 'crypto';
import jsonStableStringify from 'json-stable-stringify';
import * as fs from 'fs';
import { version } from '../../package.json';

const isCacheEnabled = process.env.SIDEKICK_CACHE !== 'false';
if (!isCacheEnabled) {
	console.warn(`Sidekick caching is disabled`);
}

export class CacheModel extends Model(
	'cache',
	z.object({
		_id: z.string(),
		version: z.string(),
		hash: z.string(),
		value: z.unknown(),
	}),
) {
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

	static async set<T>(key: string, hash: string, value: T) {
		if (!isCacheEnabled) {
			return;
		}

		await this.repository.remove({ _id: key });
		await this.repository.insert({
			_id: key,
			version,
			hash,
			value,
		});
	}

	static async get(key: string, hash: string): Promise<unknown | null> {
		if (!isCacheEnabled) {
			return null;
		}

		const entry = await this.repository.findOne({
			_id: key,
		});
		if (!entry) {
			return null;
		}
		if (entry.hash !== hash || entry.version !== version) {
			await this.repository.remove({ _id: key });
			return null;
		}
		return entry.value;
	}
}
