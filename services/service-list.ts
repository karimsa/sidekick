import { objectEntries } from '../utils/util-types';
import { ConfigManager } from './config';
import * as fs from 'fs';
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
	tags: string[];
}

export class ServiceList {
	static async getServices() {
		return this.loadServicesFromPaths(await this.getServiceDefinitions());
	}

	static async getServiceNames() {
		return (await this.getServiceDefinitions()).map((service) => service.name);
	}

	static async getService(name: string) {
		const definitions = await this.getServiceDefinitions();
		const serviceDefn = definitions.find((defn) => defn.name === name);
		if (!serviceDefn) {
			throw new Error(`Could not find a service with the name: ${name}`);
		}
		return this.loadServiceFromPath(serviceDefn);
	}

	private static async getServiceDefinitions() {
		const projectPath = await ConfigManager.getProjectPath();
		const packageJson = parseJson(
			z.object({
				workspaces: z.any().optional(),
			}),
			await fs.promises.readFile(
				path.resolve(projectPath, 'package.json'),
				'utf8',
			),
		);

		if (packageJson.workspaces) {
			return this.getServicesWithYarnWorkspaces();
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

	private static async getServicesWithYarnWorkspaces() {
		const projectPath = await ConfigManager.getProjectPath();

		const { stdout } = await execa.command('yarn workspaces info --json', {
			cwd: projectPath,
			stdin: 'ignore',
			stderr: 'inherit',
		});
		const lines = stdout
			.split(/\n/g)
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

	private static async getServicesWithLerna() {
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
		const { ports, actions, devServers, tags } = parseJson(
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
			}),
			serviceSidekickConfigStr,
		);

		return {
			name,
			location,
			version,
			scripts: servicePackageJson.scripts ?? {},
			ports: ports ?? [],
			actions: actions ?? [],
			devServers: devServers ?? {
				all: 'npm start',
			},
			tags: tags ?? [],
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
