import { ExecUtils } from '../utils/exec';
import { validate } from '../utils/http';
import { objectEntries } from '../utils/util-types';
import { ConfigManager } from './config';
import * as fs from 'fs';
import * as t from 'io-ts';
import * as path from 'path';

export interface ServiceConfig {
    name: string;
    location: string;
    version: string;
    scripts: Record<string, string>;
    ports: { type: 'http' | 'tcp'; port: number }[];
    actions: { label: string; command: string }[];
    devServers: Record<string, string>;
}

const serviceListCache = new Map<string, ServiceConfig>();

export class ServiceList {
    static async getServices() {
        return this.loadServicesFromPaths(await this.getServiceDefinitions());
    }

    static async getServiceNames() {
        if (serviceListCache.size > 0) {
            return [...serviceListCache.keys()];
        }
        return (await this.getServiceDefinitions()).map(service => service.name);
    }

    static async getService(name: string) {
        if (serviceListCache.has(name)) {
            return serviceListCache.get(name)!;
        }

        const definitions = await this.getServiceDefinitions();
        const serviceDefn = definitions.find(defn => defn.name === name);
        if (!serviceDefn) {
            throw new Error(`Could not find a service with the name: ${name}`);
        }
        const defn = await this.loadServiceFromPath(serviceDefn);
        serviceListCache.set(name, defn);
        return defn;
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

    private static async getPackageVersion(location: string) {
        const packageJson = await fs.promises.readFile(path.resolve(location, 'package.json'), 'utf8');
        return JSON.parse(packageJson);
    }

    private static async getServicesWithYarnWorkspaces() {
        const projectPath = await ConfigManager.getProjectPath();
        const infoOutput = await ExecUtils.runCommand(`yarn`, ['workspaces', 'info', '--json'], { cwd: projectPath });

        const workspaceConfig = validate(
            t.record(
                t.string,
                t.interface({
                    location: t.string
                })
            ),
            JSON.parse(infoOutput)
        );

        return Promise.all(
            objectEntries(workspaceConfig).map(async ([name, { location }]) => ({
                name,
                version: await this.getPackageVersion(path.resolve(projectPath, location)),
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
        const servicePackageJson = JSON.parse(
            await fs.promises.readFile(path.resolve(location, 'package.json'), 'utf8')
        );

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
