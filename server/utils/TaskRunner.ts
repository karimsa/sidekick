import { Logger } from '../services/logger';
import getNextConfig from 'next/config';
import { memoize } from './memoize';

const logger = new Logger('tasks');

type TaskData = {
	name: string;
	task: () => void;
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
			task.task();
		}
	}, 0);
}

/**
 * Start a long-running task.
 * NOTE: This function must be called at top level.
 */
export function startTask(name: string, task: () => Promise<void>): () => void {
	// Skip running tasks during SSR
	if (getNextConfig()?.__NEXT_SSR_ENV__) {
		return async () => {};
	}

	const taskFn = memoize(() => runTask(name, task));
	TasksQueue.push({ name, task: taskFn });

	return taskFn;
}

async function runTask(name: string, task: () => Promise<void>) {
	logger.debug(`Starting task`, { task: name });

	try {
		await task();
	} catch (err) {
		logger.error(`Task failed`, {
			err,
			task: name,
		});

		process.exit(1);
	}
}
