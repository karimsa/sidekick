import * as esbuild from 'esbuild';
import * as fs from 'fs';
import merge from 'lodash/merge';
import omit from 'lodash/omit';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

import { loadModule } from '../utils/load-module';
import { Defined } from '../utils/util-types';

export type ReleaseChannel = 'dev' | 'stable' | 'beta' | 'nightly';

export function isReleaseChannel(channel: unknown): channel is ReleaseChannel {
	return ['dev', 'stable', 'beta', 'nightly'].includes(String(channel));
}

const ConfigTypes = z.object({
	environments: z.record(z.string(), z.record(z.string(), z.string())),
	extensions: z.record(z.string(), z.record(z.string(), z.unknown())),
	showReactQueryDebugger: z.boolean(),
	minifyExtensionClients: z.boolean(),
	releaseChannel: z.enum(['stable', 'beta', 'nightly']),
	keyMappings: z.record(z.string(), z.string()).optional(),
	enableKeyMappings: z.boolean(),
});
type ConfigTypes = z.TypeOf<typeof ConfigTypes>;

export const SidekickConfigOverrides = z.object({
	defaultConfig: ConfigTypes.partial().optional(),
	extensions: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				icon: z.string(),
				entryPoint: z.string(),
			}),
		)
		.optional(),
});
export type SidekickConfigOverrides = z.TypeOf<typeof SidekickConfigOverrides>;
export type SidekickExtensionConfig = Defined<
	SidekickConfigOverrides['extensions']
>[number];

const validateConfig = (config: any) =>
	ConfigTypes.parse(
		merge(
			{
				environments: {
					local: {},
					production: {},
				},
				keyMappings: {
					'Command + ,': `commandPalette.runByName('Goto Settings')`,
					'Command + P': 'commandPalette.open()',
				},
				extensions: {},
				enableKeyMappings: true,
				showReactQueryDebugger: false,
				minifyExtensionClients: true,
				releaseChannel: 'stable',
			},
			config,
		),
	);

export class ConfigManager {
	private readyPromise: Promise<void>;
	private readyError: Error | null = null;
	private configData: z.TypeOf<typeof ConfigTypes> | null = null;

	constructor(
		readonly projectName: string,
		readonly projectVersion: string,
		readonly configFilePath: string,
	) {
		this.readyPromise = this.loadConfig();
	}

	private async waitForReady() {
		await this.readyPromise;
		if (this.readyError) {
			throw this.readyError;
		}
	}

	private async loadConfig() {
		let configData: object | void;
		const configOverrides = validateConfig(
			(await ConfigManager.loadProjectOverrides()).defaultConfig,
		);

		try {
			const configRawData = await fs.promises.readFile(
				this.configFilePath,
				'utf8',
			);
			configData = JSON.parse(configRawData);
		} catch (error: any) {
			if (error?.code !== 'ENOENT') {
				this.readyError = error;
			}
		}

		this.configData = validateConfig(merge(configOverrides, configData ?? {}));
	}

	private async flushConfig() {
		// storing as human readable
		await fs.promises.writeFile(
			this.configFilePath,
			JSON.stringify(this.configData, null, '\t'),
		);
	}

	async setValue<K extends keyof ConfigTypes>(
		key: K,
		value: ConfigTypes[K],
	): Promise<void> {
		await this.waitForReady();
		this.configData = validateConfig({
			...this.configData,
			[key]: value,
		});
		await this.flushConfig();
	}

	async getValue<K extends keyof ConfigTypes>(key: K): Promise<ConfigTypes[K]> {
		await this.waitForReady();
		return validateConfig(this.configData)[key];
	}

	async getAll() {
		await this.waitForReady();
		return Object.assign({}, this.configData!, {
			projectName: this.projectName,
			projectVersion: this.projectVersion,
			__filename: this.configFilePath,
		});
	}

	async setAll(updates: z.TypeOf<typeof ConfigTypes>) {
		await this.waitForReady();
		this.configData = validateConfig(
			omit(updates, ['projectName', 'projectVersion', '__filename']),
		);
		await this.flushConfig();
	}

	static getSidekickPath() {
		const home = os.homedir();
		return path.resolve(home, '.sidekick');
	}

	private static async fileExists(filePath: string) {
		try {
			await fs.promises.stat(filePath);
			return true;
		} catch {
			return false;
		}
	}

	static async getConfiguredReleaseChannel(): Promise<ReleaseChannel> {
		const { configFilePath } = await ConfigManager.getProjectConfigPath();

		try {
			const config = z
				.object({
					releaseChannel: z.enum(['stable', 'beta', 'nightly']).optional(),
				})
				.parse(JSON.parse(await fs.promises.readFile(configFilePath, 'utf8')));
			return config.releaseChannel ?? 'stable';
		} catch (error: any) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
			return 'stable';
		}
	}

	static async getProjectPath() {
		const projectPath = process.env.PROJECT_PATH;
		if (!projectPath) {
			throw new Error(`$PROJECT_PATH is missing from the env`);
		}
		if (!(await this.fileExists(`${projectPath}/sidekick.config.ts`))) {
			throw new Error(`Could not find sidekick.config.ts in ${projectPath}`);
		}
		return projectPath;
	}

	static async loadProjectOverrides(): Promise<SidekickConfigOverrides> {
		const projectPath = await this.getProjectPath();
		const buildConfig: esbuild.BuildOptions = {
			entryPoints: [path.resolve(projectPath, 'sidekick.config.ts')],
			target: 'node12',
			format: 'cjs',
			logLevel: 'silent',
			write: false,
		};
		const result = await esbuild
			.build(buildConfig)
			.catch((error) => {
				if (error.errors?.[0]?.text?.includes('Could not resolve')) {
					return esbuild.build({
						...buildConfig,
						entryPoints: [path.resolve(projectPath, 'sidekick.config.js')],
					});
				}
				throw error;
			})
			.catch((error) => error);
		if (result.errors?.[0]?.text?.includes('Could not resolve')) {
			return {};
		}

		const { config } = loadModule(result.outputFiles[0].text);
		return SidekickConfigOverrides.parse({
			...config,
			defaultConfig: validateConfig(config.defaultConfig ?? {}),
		});
	}

	private static async getProjectConfigPath() {
		const projectPath = await this.getProjectPath();

		try {
			const { name, version } = z
				.object({
					name: z.string({
						required_error:
							'You must provide a name for the project in the root package.json file',
					}),
					version: z.string({
						required_error:
							'There must be a version listed in the root package.json file',
					}),
				})
				.parse(
					JSON.parse(
						await fs.promises.readFile(
							path.resolve(projectPath, 'package.json'),
							'utf8',
						),
					),
				);

			const configDirectory = path.resolve(
				this.getSidekickPath(),
				name.replace(/[\W]+/g, '_'),
			);
			await fs.promises.mkdir(configDirectory, {
				recursive: true,
			});

			return {
				configFilePath: path.resolve(configDirectory, 'config.json'),
				name,
				version,
			};
		} catch (error: any) {
			throw new Error(`Failed to load package.json: ${error.message || error}`);
		}
	}

	static async createProvider() {
		const { configFilePath, name, version } = await this.getProjectConfigPath();
		return new ConfigManager(name, version, configFilePath);
	}

	static async getChannelDir(channel: ReleaseChannel) {
		if (channel === 'dev') {
			throw new Error(`Cannot find dev channel directory`);
		}
		if (channel === 'stable') {
			return path.resolve(
				await ConfigManager.getProjectPath(),
				'node_modules',
				'@karimsa/sidekick',
			);
		}
		return path.resolve(ConfigManager.getSidekickPath(), 'channels', channel);
	}

	static async getActiveChannel() {
		if (this.isDevelopment) {
			return 'dev';
		}

		const processPath = process.argv[1];
		if (processPath.startsWith(await this.getChannelDir('beta'))) {
			return 'beta';
		}
		if (processPath.startsWith(await this.getChannelDir('nightly'))) {
			return 'nightly';
		}
		return 'stable';
	}

	static isDevelopment = process.env.NODE_ENV === 'development';
}
