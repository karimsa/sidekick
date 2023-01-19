import * as tmp from 'tmp-promise';
import fs from 'fs';
import path from 'path';

export async function buildFs(files: Record<string, string | null>) {
	const { path: targetDir } = await tmp.dir();

	for (const [filename, content] of Object.entries(files)) {
		if (content) {
			await fs.promises.mkdir(path.resolve(targetDir, path.dirname(filename)), {
				recursive: true,
			});
			await fs.promises.writeFile(path.resolve(targetDir, filename), content);
		} else {
			await fs.promises.mkdir(path.resolve(targetDir, filename), {
				recursive: true,
			});
		}
	}

	return {
		path: targetDir,
		cleanup: async () => fs.promises.rmdir(targetDir, { recursive: true }),
	};
}
