import inquirer from 'inquirer';
import * as execa from 'execa';

async function getCherryPickLog(targetBranch, sourceBranch) {
	const { stdout } = await execa.command(
		`git cherry -v ${targetBranch} ${sourceBranch} | grep -E '^\\+'`,
		{ shell: true },
	);
	const commits = stdout.split('\n').map((line) => {
		line = line.replace(/^\+ /, '');
		const [hash, ...message] = line.split(' ');
		return {
			hash,
			description: message.join(' '),
		};
	});
	return commits;
}

async function getCommitsOnDevelop() {
	const commitsOnMain = await getCherryPickLog('develop', 'main');
	const promotedCommits = new Set(commitsOnMain.map((commit) => commit.hash));

	for (const commit of commitsOnMain) {
		const { stdout } = await execa.command(
			`git log --format='%B' -n 1 ${commit.hash}`,
			{
				shell: true,
			},
		);
		const cherrySource = stdout.match(
			/cherry picked from commit ([a-zA-Z0-9]+)/,
		);
		if (cherrySource) {
			promotedCommits.add(cherrySource[1]);
		}
	}

	const commitsOnDevelop = await getCherryPickLog('main', 'develop');
	return commitsOnDevelop.filter((commit) => {
		return !promotedCommits.has(commit.hash);
	});
}

async function main() {
	const commitsOnDevelop = await getCommitsOnDevelop();

	const { commits } = await inquirer.prompt([
		{
			name: 'commits',
			type: 'checkbox',
			choices: commitsOnDevelop.map((commit) => ({
				value: commit.hash,
				name: `${commit.description} (${commit.hash.substring(0, 7)})`,
			})),
			pageSize: commitsOnDevelop.length,
			loop: false,
		},
	]);
	if (commits.length === 0) {
		return;
	}

	if (
		!(
			await execa.command(`git branch | grep '*'`, { shell: true })
		).stdout.includes('main')
	) {
		await execa.command(`git checkout main`, { shell: true });
	}

	for (const commit of commits) {
		await execa.command(`git cherry-pick -x ${commit}`, { shell: true });
	}
}

main();
