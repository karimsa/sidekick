import { ExecUtils } from '../utils/exec';
import { validate } from '../utils/http';
import { objectEntries } from '../utils/util-types';
import { ConfigManager } from './config';
import * as fs from 'fs';
import * as t from 'io-ts';
import * as path from 'path';
import * as execa from 'execa';
import { parseJson } from '../utils/json';
import { z } from 'zod';

export interface ServiceConfig {
    name: string;
    location: string;
    version: string;
    scripts: Record<string, string>;
    ports: { type: 'http' | 'tcp'; port: number }[];
    actions: { label: string; command: string }[];
    devServers: Record<string, string>;
}

export class ServiceList {
    static async getServices() {
        return this.loadServicesFromPaths(await this.getServiceDefinitions());
    }

    static async getServiceNames() {
        return (await this.getServiceDefinitions()).map(service => service.name);
    }

    static async getService(name: string) {
        const definitions = await this.getServiceDefinitions();
        const serviceDefn = definitions.find(defn => defn.name === name);
        if (!serviceDefn) {
            throw new Error(`Could not find a service with the name: ${name}`);
        }
        return this.loadServiceFromPath(serviceDefn);
    }

    private static async getServiceDefinitions() {
        const projectPath = await ConfigManager.getProjectPath();
        const rootFiles = await fs.promises.readdir(projectPath);
        const packageJson = JSON.parse(await fs.promises.readFile(path.resolve(projectPath, 'package.json'), 'utf8'));

        if (packageJson.workspaces) {
            return this.getServicesWithYarnWorkspaces();
        }

        if (rootFiles.includes('lerna.json')) {
            return this.getServicesWithLerna();
        }

        throw new Error(`Cannot find services`);
    }

    private static async getPackageJson(location: string) {
        const packageJson = await fs.promises.readFile(path.resolve(location, 'package.json'), 'utf8');
        return JSON.parse(packageJson);
    }

    private static async getServicesWithYarnWorkspaces() {
        const projectPath = await ConfigManager.getProjectPath();
        const { stdout } = await execa.command('yarn workspaces info --json', { cwd: projectPath, stderr: 'pipe' });
        const workspaceConfig = parseJson(
            z.record(
                z.string(),
                z.object({
                    location: z.string({ required_error: 'Location info was missing in yarn workspaces output' })
                })
            ),
            stdout
        );

        return Promise.all(
            objectEntries(workspaceConfig).map(async ([name, { location }]) => ({
                name,
                version: (await this.getPackageJson(path.resolve(projectPath, location))).version,
                location: path.resolve(projectPath, location)
            }))
        );
    }

    private static async getServicesWithLerna() {
        const projectPath = await ConfigManager.getProjectPath();

        const listOutput = await ExecUtils.runCommand(`lerna`, ['list', '--all', '--json'], { cwd: projectPath });

        const lernaList = validate(
            t.array(
                t.interface({
                    name: t.string,
                    location: t.string,
                    version: t.string
                })
            ),
            JSON.parse(listOutput)
        );
        return lernaList.map(({ name, location, version }) => ({
            name,
            location,
            version
        }));
    }

    private static async loadServiceFromPath({
        name,
        location,
        version
    }: {
        name: string;
        location: string;
        version: string;
    }): Promise<ServiceConfig> {
        const servicePackageJson = await this.getPackageJson(location);

        const { ports, actions, devServers } = validate(
            t.partial({
                ports: t.array(
                    t.interface({
                        type: t.union([t.literal('http'), t.literal('tcp')]),
                        port: t.number
                    })
                ),
                actions: t.array(
                    t.interface({
                        label: t.string,
                        command: t.string
                    })
                ),
                devServers: t.record(t.string, t.string)
            }),
            servicePackageJson.sidekick ?? {}
        );

        return {
            name,
            location,
            version,
            scripts: servicePackageJson.scripts ?? {},
            ports: ports ?? [],
            actions: actions ?? [],
            devServers: devServers ?? {
                all: 'npm start'
            }
        };
    }

    private static async loadServicesFromPaths(services: { name: string; location: string; version: string }[]) {
        return Promise.all(
            services.map(async ({ name, location, version }) => {
                return this.loadServiceFromPath({ name, location, version });
            })
        );
    }
}
