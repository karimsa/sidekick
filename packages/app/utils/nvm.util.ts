import * as fs from 'fs';
import { parseJson } from './json';
import { z } from 'zod';
import * as path from 'path';

export class NvmUtil {
	static async safeLoadPackageJson(targetDir: string) {
		try {
			return await fs.promises.readFile(targetDir + '/package.json', 'utf8');
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	static async detectNodeVersion(targetDir: string): Promise<string> {
		// If no node version is found, default to sidekick's node version
		if (targetDir === '/') {
			return process.version;
		}

		const packageJson = await this.safeLoadPackageJson(targetDir);
		if (packageJson) {
			const { engines: { node } = { node: '' } } = parseJson(
				z.object({
					engines: z
						.object({
							node: z
								.string()
								.regex(
									/^[0-9.]+$/,
									'Complex node engine version notation is not supported, only exact versions are supported',
								)
								.optional(),
						})
						.optional(),
				}),
				packageJson,
			);
			if (node) {
				return node;
			}
		}
		return this.detectNodeVersion(path.dirname(targetDir));
	}

	static async checkNvmInstalled() {
		try {
			await fs.promises.readFile(process.env.HOME + '/.nvm/nvm.sh');
			return true;
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
			return false;
		}
	}

	static async wrapVersionedCommand(targetDir: string, cmd: string) {
		const nodeVersion = await this.detectNodeVersion(targetDir);
		return `source ~/.nvm/nvm.sh && nvm use ${nodeVersion} && ${cmd}`;
	}
}
