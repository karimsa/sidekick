import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { ConfigManager, ReleaseChannel } from '../services/config';

export class UpgradeUtils {
	/**
	 * Reads the stored build info from an installed sidekick channel.
	 */
	static async getBuildInfo(releaseChannel: ReleaseChannel) {
		try {
			const targetDir = await ConfigManager.getChannelDir(releaseChannel);
			const { nodeVersion, arch } = z
				.object({
					nodeVersion: z.string(),
					arch: z.string(),
				})
				.parse(
					JSON.parse(
						await fs.promises.readFile(
							path.resolve(targetDir, 'sidekick.build.json'),
							'utf8',
						),
					),
				);
			const nodeMajorVersion = Number(nodeVersion.split(/[v.]/)[1]);
			return {
				nodeMajorVersion,
				nodeVersion,
				arch,
			};
		} catch {
			throw new Error(
				`Sidekick ${releaseChannel} installation is corrupted. Please reinstall.`,
			);
		}
	}

	static async isMissingBuildInfo(releaseChannel: ReleaseChannel) {
		try {
			await this.getBuildInfo(releaseChannel);
			return false;
		} catch {
			return true;
		}
	}

	/**
	 * Gets the version string of an installed channel.
	 */
	static async getChannelVersion(channel: 'beta' | 'nightly') {
		try {
			await fs.promises.stat(
				path.resolve(
					await ConfigManager.getChannelDir(channel),
					'package.json',
				),
			);
		} catch (err: any) {
			if (err.code === 'ENOENT') {
				return null;
			}
			throw err;
		}

		const { stdout } = await execa.command(`git log -n1 --pretty=%H`, {
			cwd: await ConfigManager.getChannelDir(channel),
		});
		return stdout.trim();
	}
}
