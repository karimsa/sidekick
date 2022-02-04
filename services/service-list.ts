import { ExecUtils } from '../utils/exec';
import { validate } from '../utils/http';
import { objectEntries } from '../utils/util-types';
import { ConfigManager } from './config';
import * as fs from 'fs';
import * as t from 'io-ts';
import * as path from 'path';

export class ServiceList {
    static async getServices() {
        const projectPath = await ConfigManager.getProjectPath();
        const rootFiles = await fs.promises.readdir(projectPath);
        const packageJson = JSON.parse(await fs.promises.readFile(path.resolve(projectPath, 'package.json'), 'utf8'));

        if (packageJson.workspaces) {
            return this.loadServicesWithYarnWorkspaces();
        }

        if (rootFiles.includes('lerna.json')) {
            return this.loadServicesWithLerna();
        }

        throw new Error(`Cannot find services`);
    }

    static async loadServicesWithYarnWorkspaces() {
        const projectPath = await ConfigManager.getProjectPath();
        const infoOutput = await ExecUtils.runCommand(`yarn workspaces info --json`, { cwd: projectPath });

        const workspaceConfig = validate(
            t.record(
                t.string,
                t.interface({
                    location: t.string
                })
            ),
            JSON.parse(infoOutput)
        );

        return this.loadServicesFromPaths(
            objectEntries(workspaceConfig).map(([name, { location }]) => ({
                name,
                location: path.resolve(projectPath, location)
            }))
        );
    }

    static async loadServicesWithLerna() {
        const projectPath = await ConfigManager.getProjectPath();

        const listOutput = await ExecUtils.runCommand(`lerna list --all --json`, { cwd: projectPath });

        const lernaList = validate(
            t.array(
                t.interface({
                    name: t.string,
                    location: t.string
                })
            ),
            JSON.parse(listOutput)
        );
        return this.loadServicesFromPaths(
            lernaList.map(({ name, location }) => ({
                name,
                location
            }))
        );
    }

    static async loadServicesFromPaths(
        services: { name: string; location: string }[]
    ): Promise<
        { name: string; location: string; scripts: Record<string, string>; devServers: Record<string, string> }[]
    > {
        return Promise.all(
            services.map(async ({ name, location }) => {
                const servicePackageJson = JSON.parse(
                    await fs.promises.readFile(path.resolve(location, 'package.json'), 'utf8')
                );
                return {
                    name,
                    location,
                    scripts: servicePackageJson.scripts ?? {},
                    devServers: servicePackageJson.devServers ?? {
                        all: 'npm start'
                    }
                };
            })
        );
    }
}
