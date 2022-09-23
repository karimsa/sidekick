import { Logger } from '../services/logger';

const logger = new Logger('tasks');

export async function startTask(
	name: string,
	task: (defer: (fn: () => Promise<void>) => void) => Promise<void>,
) {
	// Skip running tasks during SSR
	if (global.window) {
		return;
	}

	// Ensures that tasks start to run AFTER all code at global scope has finished.
	// This allows for circular imports to finish resolving before the task starts
	// to execute
	await new Promise((res) => setTimeout(res, 0));

	const deferredFuncs: (() => Promise<void>)[] = [];

	try {
		await task((fn) => {
			deferredFuncs.unshift(fn);
		});
	} catch (err) {
		logger.error(`Task failed, cleaning up`, {
			err,
			task: name,
			numCleanupFuns: deferredFuncs.length,
		});

		for (const fn of deferredFuncs) {
			await fn();
		}
	}
}
