import * as fs from 'fs';

export async function fileExists(filePath: string) {
	try {
		await fs.promises.stat(filePath);
		return true;
	} catch (err: any) {
		if (err.code === 'ENOENT') {
			return false;
		}
		throw err;
	}
}
