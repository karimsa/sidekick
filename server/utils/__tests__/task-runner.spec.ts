import { describe, expect, it, jest } from '@jest/globals';
import {
	startTask,
	dispatchTasks,
	resetTaskQueueForTesting,
} from '../TaskRunner';

describe('Task Runner', () => {
	it('should not run without being enabled', async () => {
		resetTaskQueueForTesting();

		let taskCallback: () => void;
		const taskPromise = new Promise<void>((res) => (taskCallback = res));

		const mock = jest.fn<() => Promise<void>>().mockImplementation(async () => {
			taskCallback();
		});

		startTask('Test Task', mock);

		expect(mock).not.toBeCalled();

		await new Promise((res) => setTimeout(res, 500));

		expect(mock).not.toBeCalled();

		dispatchTasks();

		await taskPromise;

		expect(mock).toBeCalledTimes(1);
	});
});
