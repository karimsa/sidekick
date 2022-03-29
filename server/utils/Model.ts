import Datastore, { RemoveOptions } from 'nedb';
import path from 'path';
import { ConfigManager } from '../../services/config';
import { z } from 'zod';

export class Repository<T extends { _id: string }> {
	protected readonly db: Datastore;

	constructor(
		private readonly name: string,
		private readonly schema: z.Schema<T>,
	) {
		this.db = new Datastore({
			filename: path.resolve(ConfigManager.getSidekickPath(), `${name}.db`),
			autoload: true,
		});
	}

	async find(query: any) {
		return new Promise<T[]>((resolve, reject) => {
			this.db.find(query, (err: Error | null, results: T[]) => {
				if (err) {
					reject(err);
				} else {
					resolve(results);
				}
			});
		});
	}

	async findOne(query: any) {
		return new Promise<T | null>((resolve, reject) => {
			this.db.findOne(query, (err: Error | null, result: T | null) => {
				if (err) {
					reject(err);
				} else {
					resolve(result ?? null);
				}
			});
		});
	}

	async insert(document: T) {
		const insertCandidate = this.schema.parse(document);

		return new Promise<void>((resolve, reject) => {
			this.db.insert(insertCandidate, (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	async remove(query: any, { multi }: { multi?: boolean } = {}) {
		return new Promise<void>((resolve, reject) => {
			this.db.remove(query, { multi }, (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}
}

export function Model<T extends { _id: string }>(
	name: string,
	schema: z.Schema<T>,
) {
	return class {
		static repository = new Repository(name, schema);
	};
}
