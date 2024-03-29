import parseArgs from 'minimist';
import { z } from 'zod';
import { ConfigManager } from '../services/config';
import { fmt } from '../utils/fmt';
import { objectEntries, objectKeys } from '../utils/util-types';

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
	return 1;
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
	return 1;
}

export async function runCliWithArgs(argv: string[]): Promise<number> {
	try {
		const commandName = argv[0];
		if (!commandName || commandName[0] === '-') {
			console.log(`Command missing`);
			return showHelp();
		}

		const command = commands.find((cmd) => cmd.name === commandName);
		if (!command) {
			console.error(`Unknown command: ${commandName}`);
			return showHelp();
		}
		if (argv.includes('--help') || argv.includes('-h')) {
			return showCommandHelp(command);
		}

		const args = parseArgs(argv.slice(1), {
			alias: objectKeys(getShape(command.options)).reduce(
				(aliases, option) => ({ ...aliases, [option[0]]: option }),
				{},
			),
		});
		const result = command.options.safeParse(args);
		if (result.success) {
			const options = result.data;
			await command.action({
				projectDir: await ConfigManager.getProjectPath(),
				...options,
				args: args._,
			});
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
			return showCommandHelp(command);
		}

		return 0;
	} catch (error: any) {
		console.error(error.stack || error);
		return 1;
	}
}
