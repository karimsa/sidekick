import { Logger } from '../services/logger';
import getNextConfig from 'next/config';

const logger = new Logger('tasks');

type Task = (defer: (fn: () => Promise<void>) => void) => Promise<void>;
type TaskData = {
	name: string;
	task: Task;
};

const TasksQueue: TaskData[] = [];

export function resetTaskQueueForTesting() {
	TasksQueue.splice(0, TasksQueue.length);
}

export function dispatchTasks() {
	setTimeout(() => {
		// Ensures that tasks start to run AFTER all code at global scope has finished.
		// This allows for circular imports to finish resolving before the task starts
		// to execute
		for (const task of TasksQueue.splice(0, TasksQueue.length)) {
			runTask(task.name, task.task);
		}
	}, 0);
}

/**
 * Start a long-running task.
 * NOTE: This function must be called at top level.
 */
export function startTask(name: string, task: Task) {
	// Skip running tasks during SSR
	if (getNextConfig()?.__NEXT_SSR_ENV__) {
		return;
	}

	TasksQueue.push({ name, task });
}

async function runTask(name: string, task: Task) {
	const deferredFuncs: (() => Promise<void>)[] = [];

	logger.debug(`Starting task`, { task: name });

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
