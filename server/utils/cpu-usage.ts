import { startTask } from './TaskRunner';
import pidusage from 'pidusage';
import throttle from 'lodash/throttle';
import { Logger } from '../services/logger';

const logger = new Logger('cpu');

const avg = (arr: number[]) =>
	arr.reduce((sum, num) => sum + num, 0) / arr.length;
const warn = throttle(
	(usage: number) =>
		logger.warn(
			`⚠️  Sidekick is using an abnormal amount of CPU (${usage.toFixed(2)}%)`,
		),
	1 * 60 * 1e3,
	{ leading: true, trailing: true },
);

export const startCpuUsageWatcher = (maxCpu: number) =>
	startTask('cpuUsageWatch', async () => {
		const usageOverTime: number[] = [];

		while (true) {
			usageOverTime.push((await pidusage(process.pid)).cpu);
			if (usageOverTime.length > 30) {
				usageOverTime.shift();

				const usage = avg(usageOverTime);
				if (usage > maxCpu) {
					warn(usage);
				}
			}

			await new Promise((resolve) => setTimeout(resolve, 1e3));
		}
	});
