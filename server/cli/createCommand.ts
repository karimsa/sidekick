import { z } from 'zod';
import parseArgs from 'minimist';
import * as fs from 'fs';
import * as path from 'path';
import { objectEntries, objectKeys } from '../utils/util-types';
import { fmt } from '../utils/fmt';

interface Command<Options> {
	name: string;
	description: string;
	options: z.Schema<Options>;
	action: (
		options: Options & { projectDir: string; args: string[] },
	) => Promise<void>;
}

const commands: Command<any>[] = [];

export function createCommand<Options>(command: Command<Options>) {
	commands.push(command);
}

function getShape(schema: z.Schema<any>) {
	const { shape } = schema as any as {
		shape: Record<string, z.Schema<any>>;
	};
	return shape;
}

function isZodType(name: string, schema: any): boolean {
	if (schema._def?.typeName === name) {
		return true;
	}
	if (schema.innerType) {
		return isZodType(name, schema.innerType);
	}
	return false;
}

function getDefaultValue(schema: z.ZodSchema<any>) {
	// @ts-ignore
	return schema._def.defaultValue
		? // @ts-ignore
		  ` (default: ${schema._def.defaultValue()})`
		: ``;
}

function showHelp() {
	console.error(`usage: sidekick [command] [options]`);
	console.error(``);

	const longestCommandName = Math.max(
		...commands.map((cmd) => cmd.name.length),
	);
	for (const { name, description } of commands) {
		console.error(
			`  ${name}${' '.repeat(
				longestCommandName - name.length + 2,
			)}${description}`,
		);
	}

	console.error(``);
	process.exit(1);
}

function showCommandHelp(command: Command<any>) {
	console.error(`usage: sidekick ${command.name} [options]`);
	console.error(``);

	const shape = getShape(command.options);

	const flagOutputs = objectEntries(shape).map(([flagName, schema]) =>
		[
			`  -${flagName[0]}, --${flagName}`,
			isZodType('ZodBoolean', schema._def) ? '' : ` [value]`,
		].join(''),
	);
	const longestFlagName = Math.max(...flagOutputs.map((flag) => flag.length));
	for (const [index, schema] of Object.values(shape).entries()) {
		console.error(
			[
				flagOutputs[index],
				' '.repeat(longestFlagName - flagOutputs[index].length + 2),
				schema.description,
				getDefaultValue(schema),
			].join(''),
		);
	}
	console.error(
		`  -h, --help${' '.repeat(
			longestFlagName - '  -h, --help'.length + 2,
		)}Show this help message`,
	);

	console.error(``);
	process.exit(1);
}

function getProjectDir(currentDir: string, checkedDirs: string[]): string {
	if (fs.existsSync(`${currentDir}/sidekick.config.ts`)) {
		return currentDir;
	}
	if (currentDir === '/') {
		throw new Error(
			`Could not find sidekick.config.ts file\nChecked:\n${checkedDirs
				.map((dir) => `\t${dir}`)
				.join('\n')}`,
		);
	}
	return getProjectDir(path.dirname(currentDir), [...checkedDirs, currentDir]);
}

setImmediate(async () => {
	try {
		const commandName = process.argv[2];
		if (!commandName || commandName[0] === '-') {
			console.log(`Command missing`);
			showHelp();
			return;
		}

		const command = commands.find((cmd) => cmd.name === commandName);
		if (!command) {
			console.error(`Unknown command: ${commandName}`);
			showHelp();
			return;
		}
		if (process.argv.includes('--help') || process.argv.includes('-h')) {
			showCommandHelp(command);
			return;
		}

		const args = parseArgs(process.argv.slice(3), {
			alias: objectKeys(getShape(command.options)).reduce(
				(aliases, option) => ({ ...aliases, [option[0]]: option }),
				{ t: 'targetDirectory' },
			),
		});
		const result = z
			.intersection(
				command.options,
				z.object({
					targetDirectory: z
						.string({ description: '' })
						.default(process.env.PROJECT_PATH || './'),
				}),
			)
			.safeParse(args);
		if (result.success) {
			const { targetDirectory, ...options } = result.data;
			const normalizedDirectory =
				targetDirectory?.[0] === '~'
					? path.join(process.env.HOME!, targetDirectory.substring(1))
					: targetDirectory;
			const projectDir = getProjectDir(
				path.resolve(process.cwd(), normalizedDirectory ?? '.'),
				[],
			);
			process.env.PROJECT_PATH = projectDir;

			await command.action({ ...options, projectDir, args: args._ });
		} else {
			const { fieldErrors, formErrors } = result.error.flatten();
			if (formErrors.length > 0) {
				console.error(formErrors.join('\n'));
			} else {
				console.error(
					objectEntries(fieldErrors)
						.map(([key, error]) => `--${key}: ${error}: ${fmt`${args[key]}`}`)
						.join('\n'),
				);
			}
			console.error('');
			showCommandHelp(command);
		}
	} catch (error: any) {
		console.error(error.stack || error);
		process.exit(1);
	}
});
