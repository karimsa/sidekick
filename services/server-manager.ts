import * as fs from 'fs';
import * as path from 'path';

import * as t from 'io-ts';
import { AbortController } from 'node-abort-controller';
import killPort from 'kill-port';

import { validate } from '../utils/http';
import { HealthStatus, ServiceConfig } from '../utils/shared-types';
import { ExecUtils } from '../utils/exec';
import { ProcessManager } from '../utils/process-manager';
import { ConfigManager } from './config';
import { getFilesChangedAfter, getLatestUpdatedFile } from '../utils/fs';
import { testHttp } from '../utils/healthcheck';

const Services: ServiceConfig[] = [
    {
        type: 'backend',
        core: true,
        name: 'labs-server',
        port: 3002,
        debugPort: 9222
    },
    {
        type: 'backend',
        port: 3020,
        debugPort: 9210,
        name: 'labs-server-worker',
        directoryName: 'labs-server',
        processes: {
            worker: 'yarn serve:local_worker'
        }
    },
    {
        type: 'backend',
        core: true,
        name: 'gateway',
        port: 3005,
        debugPort: 9293,
        env: {
            LOCAL_SERVICES: 'yes'
        }
    },
    {
        type: 'backend',
        core: true,
        name: 'eggshell',
        healthPath: '/api/healthz',
        port: 3000,
        debugPort: 9229
    },
    {
        type: 'backend',
        core: true,
        name: 'retainer',
        port: 3004,
        debugPort: 9249
    },
    {
        type: 'backend',
        name: 'threeoxz',
        core: true,
        port: 3007,
        debugPort: 9299
    },
    {
        type: 'backend',
        core: true,
        name: 'excavator',
        port: 3008,
        debugPort: 9239
    },
    {
        type: 'frontend',
        core: true,
        name: 'external-portal',
        port: 3011,
        processes: {
            all: 'npm run serve:local'
        }
    },
    {
        type: 'frontend',
        core: true,
        name: 'practice',
        port: 3001,
        processes: {
            all: 'npm run serve:local'
        },
        env: {
            TSC_COMPILE_ON_ERROR: 'true',
            DISABLE_ESLINT_PLUGIN: 'true'
        }
    },
    {
        type: 'frontend',
        core: true,
        name: 'admin',
        port: 3003,
        processes: {
            all: 'npm run serve:local'
        },
        env: {
            TSC_COMPILE_ON_ERROR: 'true',
            DISABLE_ESLINT_PLUGIN: 'true'
        }
    },

    {
        type: 'package',
        name: 'graphql-operations',
        core: true,
        processes: {
            all: 'npm run serve:local'
        }
    },
    {
        type: 'package',
        name: 'graphql-react',
        core: true,
        processes: {
            all: 'npm run serve:local'
        }
    },

    ...[
        'eventsourced',
        'dentin',
        'infra',
        'moment-business-days',
        'mui-table',
        'redux-async-actions',
        'retainer-common',
        'sdk',
        'services',
        'session-client',
        'shared-types',
        'ui',
        'veneer'
    ].map(name => ({
        type: 'package' as const,
        name,
        processes: {
            all: 'npm run serve:local'
        }
    }))
];

export class ServerManager {
    static async getServiceList() {
        return Promise.all(
            Services.map(async serviceConfig => {
                const packageJson = JSON.parse(
                    await fs.promises.readFile(
                        path.resolve(
                            await ConfigManager.getProjectPath(),
                            serviceConfig.type === 'package' ? 'packages' : 'apps',
                            serviceConfig.directoryName ?? serviceConfig.name,
                            'package.json'
                        ),
                        'utf8'
                    )
                );
                if (!serviceConfig.processes && packageJson.scripts['prebuilt:serve:local']) {
                    const processes = Object.keys(packageJson.scripts)
                        .filter(key => key.startsWith('prebuilt:serve:local-'))
                        .map(key => key.substr('prebuilt:serve:local-'.length));
                    return {
                        ...serviceConfig,
                        processes: processes.reduce(
                            (processes, devServerName) => ({
                                ...processes,
                                [devServerName]: packageJson.scripts[`prebuilt:serve:local-${devServerName}`]
                            }),
                            {}
                        )
                    };
                }

                return serviceConfig;
            })
        );
    }

    private static async getServiceConfig(name: string) {
        const serviceConfig = (await this.getServiceList()).find(service => service.name === name);
        if (!serviceConfig) {
            throw new Error(`Unrecognized service name: ${name}`);
        }
        return serviceConfig;
    }

    static async forAll(statusFilter: HealthStatus[], handler: (service: ServiceConfig) => Promise<void>) {
        const services = await ServerManager.getServiceList();
        await Promise.all(
            services.map(async service => {
                if (statusFilter.includes(await ServerManager.getHealth(service.name))) {
                    await handler(service);
                }
            })
        );
    }

    static async getLogs({
        app,
        devServer,
        onStdout,
        abortController
    }: {
        app: string;
        devServer: string;
        onStdout: (chunk: string) => void;
        abortController: AbortController;
    }) {
        await ProcessManager.watchLogs({
            name: `${app}-${devServer}`,
            onLogEntry: onStdout,
            abortController
        });
    }

    static async isBuildStale(name: string) {
        const serviceConfig = await this.getServiceConfig(name);

        const servicePath = path.join(
            await ConfigManager.getProjectPath(),
            serviceConfig.type !== 'package' ? 'apps' : 'packages',
            serviceConfig.directoryName ?? serviceConfig.name
        );
        const latestSrc = await getLatestUpdatedFile(path.join(servicePath, 'src'));
        const latestDist = await getLatestUpdatedFile(path.join(servicePath, 'dist'));

        return !latestDist || !latestSrc || latestDist[1] < latestSrc[1];
    }

    static async getAppStaleFiles(name: string) {
        const serviceConfig = await this.getServiceConfig(name);

        const projectPath = await ConfigManager.getProjectPath();
        const servicePath = path.join(
            projectPath,
            serviceConfig.type !== 'package' ? 'apps' : 'packages',
            serviceConfig.directoryName ?? serviceConfig.name
        );
        const latestDist = (await getLatestUpdatedFile(path.join(servicePath, 'dist'))) ?? ['', 0];

        const changedFiles = await getFilesChangedAfter(path.join(servicePath, 'src'), new Date(latestDist[1]));
        return Promise.all(
            changedFiles.map(async file => {
                return {
                    file: file.substr(servicePath.length + 1),
                    commit: (
                        await ExecUtils.runCommand(`git`, ['log', '--oneline', '-n1', '--', file], {
                            cwd: projectPath
                        })
                    ).trim()
                };
            })
        );
    }

    static async markAsPrepared(name: string) {
        const serviceConfig = await this.getServiceConfig(name);

        await fs.promises.writeFile(
            path.join(
                await ConfigManager.getProjectPath(),
                serviceConfig.type !== 'package' ? 'apps' : 'packages',
                serviceConfig.directoryName ?? serviceConfig.name,
                'dist',
                '.hygenist-prepared'
            ),
            ''
        );
    }

    static async prepareAllServices(inputServices: string[], onStdout: (chunk: string) => void) {
        const projectPath = await ConfigManager.getProjectPath();
        await ExecUtils.runCommand(
            `lerna run prepare --stream ${inputServices.map(target => `--scope @orthly/${target}`).join(' ')} 2>&1`,
            {
                cwd: projectPath,
                onStdout
            }
        );
        await Promise.all(inputServices.map(target => this.markAsPrepared(target)));
    }

    static async getHealth(name: string): Promise<HealthStatus> {
        const serviceConfig = await this.getServiceConfig(name);

        const isResponding =
            serviceConfig.type !== 'package'
                ? await testHttp(
                      `http://localhost:${serviceConfig.port}${
                          serviceConfig.healthPath || (serviceConfig.type === 'frontend' ? '/' : '/healthz')
                      }`
                  )
                : false;

        let numRunningProcesses = 0;
        await Promise.all(
            Object.keys(serviceConfig.processes).map(async devServer => {
                if (await ProcessManager.isProcessRunning(`${name}-${devServer}`)) {
                    numRunningProcesses++;
                }
            })
        );

        const numExpectedProcesses = Object.keys(serviceConfig.processes).length;

        if (numRunningProcesses === numExpectedProcesses) {
            const suspensionStates = await Promise.all(
                Object.keys(serviceConfig.processes).map(async devServer => {
                    return ProcessManager.isSuspended(`${name}-${devServer}`);
                })
            );
            if (suspensionStates.reduce((isSuspended, isProcessSuspended) => isSuspended && isProcessSuspended, true)) {
                return HealthStatus.paused;
            }

            if (isResponding || serviceConfig.type === 'package') {
                return HealthStatus.healthy;
            }
            return HealthStatus.partial;
        }

        if (numRunningProcesses === 0) {
            if (isResponding) {
                return HealthStatus.zombie;
            }

            const isStale = serviceConfig.type === 'frontend' ? false : await this.isBuildStale(serviceConfig.name);
            if (isStale) {
                return HealthStatus.stale;
            }

            return HealthStatus.none;
        }

        return isResponding ? HealthStatus.partial : HealthStatus.failing;
    }

    static async prepare(name: string) {
        const serviceConfig = await this.getServiceConfig(name);
        await ExecUtils.runCommand(`yarn prepare`, {
            cwd: path.join(
                await ConfigManager.getProjectPath(),
                serviceConfig.type !== 'package' ? 'apps' : 'packages',
                serviceConfig.directoryName ?? serviceConfig.name
            )
        });
        await this.markAsPrepared(name);
    }

    static async stop({ name }: { name: string }) {
        const serviceConfig = await this.getServiceConfig(name);
        await Promise.all(
            Object.keys(serviceConfig.processes).map(devServerName => {
                return ProcessManager.stop(`${name}-${devServerName}`);
            })
        );
        if (serviceConfig.type !== 'package') {
            await killPort(serviceConfig.port);
        }
    }

    static async pause({ name }: { name: string }) {
        const serviceConfig = await this.getServiceConfig(name);
        await Promise.all(
            Object.keys(serviceConfig.processes).map(devServerName => {
                return ProcessManager.pause(`${name}-${devServerName}`);
            })
        );
    }

    static async resume({ name }: { name: string }) {
        const serviceConfig = await this.getServiceConfig(name);
        await Promise.all(
            Object.keys(serviceConfig.processes).map(devServerName => {
                return ProcessManager.resume(`${name}-${devServerName}`);
            })
        );
    }

    static async start({ name, envName }: { name: string; envName: string }) {
        const serviceConfig = await this.getServiceConfig(name);
        const globalConfig = await (await ConfigManager.createProvider()).getAll();
        const envVars = validate(t.record(t.string, t.string), {
            ...process.env,
            NODE_ENV: 'development',
            // TODO: fix this
            ...(serviceConfig.type === 'backend' ? globalConfig.environments[envName] : {}),
            ...(serviceConfig.env ?? {})
        });
        const projectPath = await ConfigManager.getProjectPath();

        await Promise.all(
            Object.entries(serviceConfig.processes).map(([devServerName, runCommand]) => {
                return ProcessManager.start(`${name}-${devServerName}`, runCommand, {
                    cwd: path.join(
                        projectPath,
                        serviceConfig.type !== 'package' ? 'apps' : 'packages',
                        serviceConfig.directoryName ?? serviceConfig.name
                    ),
                    env: envVars as any
                });
            })
        );
    }
}
