import * as fs from 'fs';
import * as path from 'path';

export function findProjectDir(
	currentDir: string,
	checkedDirs: string[],
): string {
	if (fs.existsSync(`${currentDir}/sidekick.config.ts`)) {
		return currentDir;
	}
	if (currentDir === '/') {
		console.error(
			`Could not find sidekick.config.ts file\nChecked:\n${checkedDirs
				.map((dir) => `\t${dir}`)
				.join('\n')}`,
		);
		process.exit(1);
	}
	return findProjectDir(path.dirname(currentDir), [...checkedDirs, currentDir]);
}

export function ensureProjectDir() {
	const projectDir = findProjectDir(
		process.env.PROJECT_PATH || process.cwd(),
		[],
	);
	process.env.PROJECT_PATH = projectDir;
	return projectDir;
}
