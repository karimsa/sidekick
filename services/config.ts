import * as fs from 'fs';
import * as path from 'path';
import * as t from 'io-ts';
import merge from 'lodash/merge';
import { validate } from '../utils/http';

import SidekickPackageJson from '../package.json';

const ConfigTypes = t.interface({
    projectPath: t.string,
    environments: t.record(t.string, t.record(t.string, t.string)),
    showReactQueryDebugger: t.boolean
});
type ConfigTypes = t.TypeOf<typeof ConfigTypes>;

const validateConfig = (config: any) =>
    validate(
        ConfigTypes,
        merge(
            {
                projectPath: '',
                environments: {
                    local: {},
                    production: {}
                },
                showReactQueryDebugger: false
            },
            config
        )
    );

export class ConfigManager {
    private readyPromise: Promise<void>;
    private readyError: Error | null = null;
    private configData: t.TypeOf<typeof ConfigTypes> | null = null;

    constructor(private readonly projectName: string, private readonly configFilePath: string) {
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

        try {
            const configRawData = await fs.promises.readFile(this.configFilePath, 'utf8');
            configData = JSON.parse(configRawData);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                this.readyError = error;
            }
        }

        this.configData = validateConfig(configData ?? {});
    }

    private async flushConfig() {
        // storing as human readable
        await fs.promises.writeFile(this.configFilePath, JSON.stringify(this.configData, null, '\t'));
    }

    async setValue<K extends keyof ConfigTypes>(key: K, value: ConfigTypes[K]): Promise<void> {
        await this.waitForReady();
        this.configData = validateConfig({
            ...this.configData,
            [key]: value
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
            version: SidekickPackageJson.version,
            __filename: this.configFilePath
        });
    }

    async setAll(updates: t.TypeOf<typeof ConfigTypes>) {
        await this.waitForReady();
        this.configData = validateConfig(updates);
        await this.flushConfig();
    }

    static getSidekickPath() {
        const home = process.env.HOME;
        if (!home) {
            throw new Error(`Whoa - no home directory specified. What sorcery is this.`);
        }
        return path.resolve(home, '.sidekick');
    }

    static async getProjectPath() {
        const projectPath = process.env.PROJECT_PATH;

        // TODO: Move this check into the CLI, so we only do it on startup
        try {
            await fs.promises.stat(path.resolve(projectPath, '.git'));
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`Please run sidekick from the root of your project (.git was not found)`);
            }
        }

        return projectPath;
    }

    static async createProvider() {
        const projectPath = await this.getProjectPath();

        try {
            const { name } = JSON.parse(await fs.promises.readFile(path.resolve(projectPath, 'package.json'), 'utf8'));

            const configDirectory = path.resolve(this.getSidekickPath(), name.replace(/[\W]+/g, '_'));
            await fs.promises.mkdir(configDirectory, {
                recursive: true
            });

            return new ConfigManager(name, path.resolve(configDirectory, 'config.json'));
        } catch (error: any) {
            throw new Error(`Failed to load package.json: ${error.message || error}`);
        }
    }
}
