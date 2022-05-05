import { HealthStatus, isActiveStatus } from '../utils/shared-types';
import * as readline from 'readline';
import { getBulkServerHealth, stopService } from '../controllers/servers';
import { ServiceConfig, ServiceList } from '../services/service-list';
import ansi from 'ansi-escapes';
import chalk from 'chalk';
import ms from 'ms';
import { objectEntries } from '../utils/util-types';
import { createCommand } from './createCommand';
import { z } from 'zod';

const clearScreen = () => process.stdout.write(ansi.clearTerminal);
const hideCursor = () => process.stdout.write(ansi.cursorHide);
const showCursor = () => process.stdout.write(ansi.cursorShow);
const isNever = (val: never) => val;

interface ServiceState {
	status: HealthStatus;
	lastChangedAt: Date;
}

interface RenderState {
	lastUpdatedAt: Date | null;
	services: Record<string, ServiceState>;
	message?: string;
}

const state: RenderState = {
	lastUpdatedAt: null,
	services: {},
};

function setMessage(message: string) {
	state.message = message;
	setTimeout(() => {
		if (state.message === message) {
			state.message = undefined;
		}
	}, 5000);
}

function startStdinBuffer() {
	const intf = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	// interface.input isn't an official feature, but is used by us anyways through our third-party packages
	const inputStream = (intf as any).input;
	inputStream.on(
		'keypress',
		async (
			_: never,
			event: { name: string; ctrl: boolean; meta: boolean; shift: boolean },
		) => {
			if (event.ctrl && event.name === 'c') {
				process.exit();
			}
			if (event.ctrl || event.meta || event.shift) {
				return;
			}

			switch (event.name) {
				case 'k':
					setMessage(`Killing processes ...`);
					await Promise.all(
						objectEntries(state.services).map(
							async ([serviceName, serviceState]) => {
								if (isActiveStatus(serviceState.status)) {
									await stopService.run({
										name: serviceName,
									});
								}
							},
						),
					);
					break;
				case 'q':
					process.exit();
					break;

				default:
					setMessage(`Unrecognized key: '${event.name}'`);
					break;
			}
		},
	);
}

function startAllHealthUpdaters() {
	getBulkServerHealth({}).subscribe({
		next: ({ serviceName, healthStatus }) => {
			state.services[serviceName] = {
				status: healthStatus,
				lastChangedAt: new Date(),
			};
			state.lastUpdatedAt = new Date();
		},
		error: (err) => {
			console.error(err.stack);
			process.exit(1);
		},
		complete: () => {},
	});
}

function logAndOverwrite(msg: string) {
	console.log(`${msg}${ansi.eraseEndLine}`);
}

// Never make this async
function render({ delay, apps }: { delay: number; apps: ServiceConfig[] }) {
	clearScreen();
	hideCursor();
	process.stdout.write(ansi.cursorTo(0, 0));

	logAndOverwrite(
		chalk.dim('Last checked: ') +
			chalk.bold.whiteBright(state.lastUpdatedAt?.toLocaleString() ?? 'never') +
			chalk.dim(` (refresh after ${ms(delay)})`),
	);
	console.log(``);

	for (const { name } of apps) {
		const serviceState = state.services[name];
		if (!serviceState) {
			continue;
		}

		switch (serviceState.status) {
			case HealthStatus.healthy:
				logAndOverwrite(`✅ ${name}`);
				break;

			case HealthStatus.partial:
				logAndOverwrite(
					`💀 ${chalk.bold.red(name)} (some ports are available)`,
				);
				break;

			case HealthStatus.failing:
				logAndOverwrite(`🔥 ${chalk.bold.red(name)}`);
				break;

			case HealthStatus.zombie:
				logAndOverwrite(
					`🧟‍ ${chalk.bold.magenta(
						name,
					)} (running, but not owned by sidekick)`,
				);
				break;

			case HealthStatus.stale:
				logAndOverwrite(`🚨‍ ${chalk.yellow(name)} (needs to be rebuilt)`);
				break;

			case HealthStatus.paused:
				logAndOverwrite(`⏸‍ ${chalk.yellow(name)}`);
				break;

			case HealthStatus.none:
				break;

			default:
				isNever(serviceState.status);
				break;
		}
	}
	console.log('');

	for (const { key, label } of [
		{ key: 'k', label: 'kill backends' },
		{ key: 'q', label: 'quit' },
	]) {
		console.log(
			chalk.dim(` › Press `) +
				chalk.bold.whiteBright(key) +
				chalk.dim(` to ${label}`),
		);
	}

	console.log();
	logAndOverwrite(state.message ?? 'Waiting for input');
	showCursor();
}

createCommand({
	name: 'monitor',
	description: 'Run a slim version of the sidekick dashboard in a TTY',
	options: z.object({}),
	async action() {
		const services = await ServiceList.getServices();

		startStdinBuffer();
		startAllHealthUpdaters();

		clearScreen();

		// eslint-disable-next-line no-constant-condition
		while (true) {
			render({ delay: 1000, apps: services });
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	},
});
