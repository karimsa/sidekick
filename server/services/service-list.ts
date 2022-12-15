import * as execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import stripAnsi from 'strip-ansi';
import { z } from 'zod';
import { parseJson } from '../utils/json';
import { Mutex } from '../utils/mutex';
import { HealthStatus } from '../utils/shared-types';
import { objectEntries } from '../utils/util-types';
import { CacheService } from './cache';
import { ConfigManager } from './config';
import { HealthService } from './health';

export interface ServiceConfig {
	name: string;
	location: string;
	version: string;
	scripts: Record<string, string>;
	dependencies: string[];
	disableStaleChecks: boolean;
	outputFiles: string[];
	sourceFiles: string[];
	ports: { type: 'http' | 'tcp'; port: number }[];
	actions: { label: string; command: string }[];
	devServers: Record<string, string>;
	rawTags: string[];
}

interface PartialServiceEntry {
	name: string;
	location: string;
	version: string;
}

export class ServiceList {
	static async getServices() {
		return this.loadServicesFromPaths(await this.getServiceDefinitions());
	}

	static async getServiceTags(name: string) {
		const serviceConfig = await this.getService(name);
		const tags = ['all', ...serviceConfig.rawTags];
		const health = await HealthService.getServiceHealth(serviceConfig.name);
		if (health.healthStatus !== HealthStatus.none) {
			tags.push('running');
		}
		return tags;
	}

	static async getServicesByTag(serviceTag: string) {
		const services: ServiceConfig[] = [];
		for (const service of await this.getServices()) {
			if ((await this.getServiceTags(service.name)).includes(serviceTag)) {
				services.push(service);
			}
		}
		return services;
	}

	static async getService(name: string) {
		const definitions = await this.getServiceDefinitions();
		const serviceDefn = definitions.find(
			(defn) =>
				defn.name === name ||
				(defn.name[0] === '@' && defn.name.split('/')[1] === name),
		);
		if (!serviceDefn) {
			throw new Error(`Could not find a service with the name: ${name}`);
		}
		return this.loadServiceFromPath(serviceDefn);
	}

	static getServiceDependencyGraph(services: ServiceConfig[]) {
		const dependencyGraph = new Map<string, string[]>();

		for (const service of services) {
			dependencyGraph.set(service.name, service.dependencies.filter(name => services.some(s => s.name === name)));
		}

		return dependencyGraph;
	}

	static getServiceDependencies(serviceName: string, services: ServiceConfig[]) {
		const serviceConfig = services.find((s) => s.name === serviceName);
		if (!serviceConfig) {
			throw new Error(`Could not find service with name: ${serviceName}`);
		}
		return serviceConfig.dependencies.flatMap(name => {
			const dependency = services.find(s => s.name === name)
			return dependency ? [dependency] : [];
		});
	}

	static async withServiceStateLock(
		serviceConfig: ServiceConfig,
		fn: () => Promise<void>,
	) {
		return Mutex.withMutex(serviceConfig.name, 5000, fn);
	}

	private static async getServiceDefinitions() {
		const projectPath = await ConfigManager.getProjectPath();
		const rootPackageJsonStr = await fs.promises.readFile(
			path.resolve(projectPath, 'package.json'),
			'utf8',
		);
		const packageJson = parseJson(
			z.object({
				workspaces: z.any().optional(),
			}),
			rootPackageJsonStr,
		);

		if (packageJson.workspaces) {
			const cacheHash = CacheService.hashObject({
				rootPackageJsonStr,
			});
			const cached = CacheService.get('yarn-workspace-list', cacheHash);
			if (cached) {
				return cached as PartialServiceEntry[];
			}

			const services = await this.getServicesWithYarnWorkspaces();
			CacheService.set('yarn-workspace-list', cacheHash, services);
			return services;
		}

		const rootFiles = await fs.promises.readdir(projectPath);
		if (rootFiles.includes('lerna.json')) {
			return this.getServicesWithLerna();
		}

		throw new Error(`Cannot find services`);
	}

	private static async getPackageJson(location: string) {
		const packageJson = await fs.promises.readFile(
			path.resolve(location, 'package.json'),
			'utf8',
		);
		return JSON.parse(packageJson);
	}

	private static async getSidekickJson(location: string) {
		try {
			return await fs.promises.readFile(
				path.resolve(location, '.sidekick.json'),
				'utf8',
			);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return '{}';
			}
			throw error;
		}
	}

	private static async getServicesWithYarnWorkspaces(): Promise<
		PartialServiceEntry[]
	> {
		const projectPath = await ConfigManager.getProjectPath();

		const { stdout } = await execa.command('yarn workspaces info --json', {
			cwd: projectPath,
			stdin: 'ignore',
			stderr: 'inherit',
		});
		const lines = stripAnsi(stdout)
			.split(/\n/g)
			// rome-ignore lint/complexity/useSimplifiedLogicExpression: <explanation>
			.filter((line) => !line.startsWith('yarn') && !line.startsWith('Done in'))
			.join('\n');

		const workspaceConfig = parseJson(
			z.record(
				z.string(),
				z.object({
					location: z.string({
						required_error:
							'Location info was missing in yarn workspaces output',
					}),
				}),
			),
			lines,
		);

		return Promise.all(
			objectEntries(workspaceConfig).map(async ([name, { location }]) => ({
				name,
				version: (
					await this.getPackageJson(path.resolve(projectPath, location))
				).version,
				location: path.resolve(projectPath, location),
			})),
		);
	}

	private static async getServicesWithLerna(): Promise<PartialServiceEntry[]> {
		try {
			const projectPath = await ConfigManager.getProjectPath();
			const { stdout: listOutput } = await execa.command(
				`lerna list --all --json`,
				{ cwd: projectPath },
			);

			const lernaList = parseJson(
				z.array(
					z.object({
						name: z.string(),
						location: z.string(),
						version: z.string(),
					}),
				),
				listOutput,
			);
			return lernaList.map(({ name, location, version }) => ({
				name,
				location,
				version,
			}));
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	private static async loadServiceFromPath({
		name,
		location,
		version,
	}: {
		name: string;
		location: string;
		version: string;
	}): Promise<ServiceConfig> {
		const servicePackageJson = await this.getPackageJson(location);
		const serviceSidekickConfigStr = await this.getSidekickJson(location);
		const {
			ports,
			actions,
			devServers,
			tags,
			disableStaleChecks,
			sourceFiles,
			outputFiles,
		} = parseJson(
			z.object({
				ports: z
					.array(
						z.object({
							type: z.union([z.literal('http'), z.literal('tcp')]),
							port: z
								.number()
								.int('Port numbers must be valid integers')
								.min(1),
						}),
					)
					.optional(),
				actions: z
					.array(
						z.object({
							label: z.string(),
							command: z.string(),
						}),
					)
					.optional(),
				devServers: z.record(z.string(), z.string()).optional(),
				tags: z.array(z.string()).optional(),
				disableStaleChecks: z.boolean().optional(),
				sourceFiles: z.array(z.string()).optional(),
				outputFiles: z.array(z.string()).optional(),
			}),
			serviceSidekickConfigStr,
		);

		return {
			name,
			location,
			version,
			scripts: servicePackageJson.scripts ?? {},
			dependencies: [...Object.keys(servicePackageJson.dependencies ?? {}), ...Object.keys(servicePackageJson.devDependencies ?? {})],
			ports: ports ?? [],
			actions: actions ?? [],
			devServers: devServers ?? {
				all: 'npm start',
			},
			rawTags: tags ?? [],
			disableStaleChecks: !!disableStaleChecks,
			sourceFiles: sourceFiles ?? ['./src/**/*.{js,jsx,ts,tsx}'],
			outputFiles: outputFiles ?? ['./dist/**/*.js'],
		};
	}

	private static async loadServicesFromPaths(
		services: { name: string; location: string; version: string }[],
	) {
		return Promise.all(
			services.map(async ({ name, location, version }) => {
				return this.loadServiceFromPath({ name, location, version });
			}),
		);
	}
}
