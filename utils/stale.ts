import * as fs from 'fs';
import path from 'path';

export async function getLatestUpdatedFile(
	directory: string,
): Promise<[string, number] | null> {
	let latest: [string, number] | null = null;
	try {
		for (const file of await fs.promises.readdir(directory)) {
			const absPath = path.join(directory, file);
			const stat = await fs.promises.stat(absPath);
			if (stat.isFile()) {
				if (!latest || +stat.mtime > latest[1]) {
					latest = [absPath, +stat.mtime];
				}
			} else {
				const latestChild = await getLatestUpdatedFile(absPath);
				if (!latest || (latestChild && latestChild[1] > latest[1])) {
					latest = latestChild;
				}
			}
		}
	} catch (error: any) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}
	return latest;
}

export async function getFilesChangedAfter(
	directory: string,
	timestamp: Date,
): Promise<string[]> {
	const changedFiles: string[] = [];
	for (const file of await fs.promises.readdir(directory)) {
		const absPath = path.join(directory, file);
		const stat = await fs.promises.stat(absPath);
		if (stat.isFile()) {
			if (stat.mtime > timestamp) {
				changedFiles.push(absPath);
			}
		} else {
			changedFiles.push(...(await getFilesChangedAfter(absPath, timestamp)));
		}
	}
	return changedFiles;
}
