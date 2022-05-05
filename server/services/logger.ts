import * as fs from 'fs';
import * as path from 'path';
import { pino as createPino } from 'pino';
import { ConfigManager } from './config';

const logFile = path.resolve(ConfigManager.getSidekickPath(), 'logs.db');
console.log(`Logs will be written to: ${logFile}`);
const logDest =
	process.env.NODE_ENV !== 'production'
		? { write: process.stdout.write.bind(process.stdout), reopen() {} }
		: createPino.destination(logFile);
const pino = createPino(
	{
		level: 'debug',
	},
	logDest,
);

const MAX_LOG_SIZE = 1024 ** 3;
const TRUNCATED_LOG_SIZE = MAX_LOG_SIZE / 2;

export class Logger {
	constructor(private readonly namespace: string) {}

	info(message: string, data: Record<string, unknown> = {}) {
		pino.info({ ...data, namespace: this.namespace }, message);
	}
	debug(message: string, data: Record<string, unknown> = {}) {
		pino.debug({ ...data, namespace: this.namespace }, message);
	}
	warn(message: string, data: Record<string, unknown> = {}) {
		pino.warn({ ...data, namespace: this.namespace }, message);
	}
	error(message: string, data: Record<string, unknown> = {}) {
		pino.error({ ...data, namespace: this.namespace }, message);
	}

	private static async rotateLogs() {
		try {
			const logger = new Logger('logs');
			const logFd = await fs.promises.open(logFile, fs.constants.O_RDWR);
			const stats = await logFd.stat();
			if (stats.size >= MAX_LOG_SIZE) {
				const content = await logFd.read(
					Buffer.allocUnsafe(TRUNCATED_LOG_SIZE),
					0,
					TRUNCATED_LOG_SIZE,
					MAX_LOG_SIZE - TRUNCATED_LOG_SIZE,
				);
				await logFd.write(content.buffer, 0, content.bytesRead, 0);
				await logFd.truncate(content.bytesRead);
				await logFd.sync();

				logDest.reopen();
				logger.info(
					`Logs truncated to ${content.bytesRead} bytes (exceeded 1GB in size)`,
				);
			}

			await logFd.close();
		} catch (err: any) {
			console.error(
				Object.assign(new Error(`Log truncation failed`), { cause: err }),
			);
		}

		setTimeout(() => Logger['rotateLogs'](), 30e3);
	}
}

setTimeout(() => Logger['rotateLogs'](), 1);
