import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { ConfigManager, ReleaseChannel } from '../services/config';
import { fmt } from './fmt';
import { version as sidekickVersion } from '../../package.json';
import axios from 'axios';
import { KVCache } from './KVCache';
import { Mutex } from './mutex';

export const RC_BRANCHES = {
	nightly: 'develop',
	beta: 'main',
} as const;

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
	static async getChannelVersion(channel: ReleaseChannel) {
		// We must check the `package.json` to get an accurate read for current _installed_
		// stable version
		if (channel === 'stable' || channel === 'dev') {
			try {
				const sidekickDir = await ConfigManager.getChannelDir('stable');
				const packageJson = JSON.parse(
					await fs.promises.readFile(
						path.resolve(sidekickDir, 'package.json'),
						'utf8',
					),
				);
				const { version } = z
					.object({ version: z.string() })
					.parse(packageJson);
				return version + (channel === 'dev' ? '-dev' : '');
			} catch (err) {
				throw Object.assign(
					new Error(`Failed to get version of sidekick ${channel}`),
					{ cause: err },
				);
			}
		}

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

		const { stdout } = await execa.command(`git log -n1 --pretty=%h`, {
			cwd: await ConfigManager.getChannelDir(channel),
		});
		return stdout.trim();
	}

	static async isChannelInstalled(channel: ReleaseChannel) {
		if (channel === 'stable' || channel === 'dev') {
			return true;
		}

		const channelDir = await ConfigManager.getChannelDir(channel);
		const isInstalled = await fs.promises
			.stat(path.resolve(channelDir, 'package.json'))
			.then(() => true)
			.catch((err) => {
				if (err.code === 'ENOENT') {
					return false;
				}
				throw err;
			});
		return isInstalled;
	}

	static async upgradeChannel(channel: 'beta' | 'nightly') {
		return await Mutex.withMutex(
			`upgrade-channel(${channel})`,
			30e3,
			async () => {
				const channelDir = await ConfigManager.getChannelDir(channel);
				const isInstalled = await this.isChannelInstalled(channel);
				if (!isInstalled) {
					console.log(fmt`Installing ${channel} channel ...`);
					await fs.promises.mkdir(channelDir, {
						recursive: true,
					});
					await execa.command(
						`git clone -b ${RC_BRANCHES[channel]} https://github.com/karimsa/sidekick.git .`,
						{
							cwd: channelDir,
						},
					);
				}

				console.log(fmt`Upgrading ${channel} channel ...`);
				{
					const cwd = channelDir;

					// get rid of local branch, in case of rebases
					await execa.command(`git reset --hard HEAD`, { cwd });
					await execa.command(`git checkout -b tmp`, { cwd }).catch(() => {});
					await execa
						.command(`git branch -D ${RC_BRANCHES[channel]}`, { cwd })
						.catch(() => {});

					// fetch updated refs
					await execa.command(`git fetch --all --prune`, { cwd });

					// create new local branch from remote
					await execa.command(`git checkout ${RC_BRANCHES[channel]}`, { cwd });
					await execa.command(`git branch -D tmp`, { cwd }).catch(() => {});
				}

				await execa.command(`yarn install --production=false`, {
					cwd: channelDir,
				});

				console.log(`Building ${channel} release ...`);
				await execa.command(`yarn build`, {
					cwd: channelDir,
				});

				await fs.promises.writeFile(
					path.resolve(channelDir, 'sidekick.build.json'),
					JSON.stringify({
						sidekickVersion,
						nodeVersion: process.version,
						arch: process.arch,
					}),
				);
			},
		);
	}

	static async getLatestVersion(channel: ReleaseChannel) {
		if (channel === 'stable' || channel === 'dev') {
			const { data } = await axios.get(
				'https://registry.npmjs.org/@karimsa/sidekick',
			);
			const packageInfo = z
				.object({
					'dist-tags': z.object({
						latest: z.string(),
					}),
				})
				.parse(data);
			return (
				packageInfo['dist-tags'].latest + (channel === 'dev' ? '-dev' : '')
			);
		}

		const cache = KVCache.forKey(
			`github-version-${channel}`,
			z.object({
				etag: z.string(),
				value: z.string(),
			}),
		);
		const cacheEntry = await cache.get();
		const {
			data,
			status,
			headers: resHeaders,
		} = await axios.get(
			`https://api.github.com/repos/karimsa/sidekick/git/ref/heads/${RC_BRANCHES[channel]}`,
			{
				headers: {
					'If-None-Match': cacheEntry?.etag ?? '',
				},
				validateStatus: (status) => status === 200 || status === 304,
			},
		);
		if (status === 304) {
			return cacheEntry?.value ?? '';
		}

		const result = z
			.object({ object: z.object({ sha: z.string() }) })
			.safeParse(data);
		if (!result.success) {
			throw new Error(`Failed to get latest commit from github`);
		}

		await cache.set({
			etag: resHeaders.etag ?? '',
			value: result.data.object.sha,
		});
		return result.data.object.sha;
	}

	static async checkForUpdates(channel: ReleaseChannel) {
		const [currentVersion, latestVersionFull, isMissingBuildInfo] =
			await Promise.all([
				UpgradeUtils.getChannelVersion(channel),
				UpgradeUtils.getLatestVersion(channel),
				UpgradeUtils.isMissingBuildInfo(channel),
			]);
		const latestVersion = latestVersionFull.slice(0, currentVersion?.length);
		return {
			currentVersion,
			latestVersion,
			needsUpgrade:
				channel === 'dev'
					? false
					: currentVersion !== latestVersion || isMissingBuildInfo,
		};
	}
}
