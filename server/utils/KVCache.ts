import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../services/config';
import { Logger } from '../services/logger';

const hasOwnProperty = {}.hasOwnProperty;
const logger = new Logger('kvcache');

export class KVCache {
	private static values: Record<string, unknown> | null = null;

	private static async getCacheFilePath() {
		return path.resolve(await ConfigManager.getSidekickPath(), 'cache.json');
	}

	static async open(): Promise<Record<string, unknown>> {
		if (KVCache.values) {
			return KVCache.values;
		}

		try {
			const targetFile = await KVCache.getCacheFilePath();
			const values = JSON.parse(await fs.promises.readFile(targetFile, 'utf8'));
			logger.info(`Loading cache`, {
				targetFile,
			});

			return (KVCache.values = values);
		} catch (err) {
			if ((err as { code: string }).code !== 'ENOENT') {
				logger.error(`Failed to load sidekick cache`, {
					err,
				});
			}

			return (KVCache.values = {});
		}
	}

	static forKey<T>(key: string, schema: z.Schema<T>) {
		return {
			async get() {
				const values = await KVCache.open();
				if (!hasOwnProperty.call(values, key)) {
					return null;
				}

				const parseResult = schema.safeParse(values[key]);
				if (!parseResult.success) {
					return null;
				}

				return parseResult.data;
			},
			async delete() {
				const values = await KVCache.open();
				delete values[key];
				await KVCache.syncCache();
			},
			async set(value: T) {
				const values = await KVCache.open();
				values[key] = schema.parse(value);
				await KVCache.syncCache();
			},
		};
	}

	private static async syncCache() {
		if (KVCache.values) {
			const targetFile = await KVCache.getCacheFilePath();
			await fs.promises.writeFile(targetFile, JSON.stringify(KVCache.values));
		}
	}
}
