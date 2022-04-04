import chalk from 'chalk';

export function printTable(header: string[], table: string[][]): string {
	const minSpacingBetweenColumns = 2;
	const colWidths: number[] = header.map((heading, index) => {
		return (
			minSpacingBetweenColumns +
			Math.max(heading.length, ...table.map((row) => row[index]?.length))
		);
	});
	let tableString = '';

	[header, ...table].forEach((row, rowIndex) => {
		row.forEach((elm, col) => {
			const colWidth = colWidths[col] || minSpacingBetweenColumns;
			const strRow = `${elm}${' '.repeat(colWidth - elm.length)}`;

			tableString += rowIndex === 0 ? chalk.red(strRow) : strRow;
		});
		tableString += '\n';
	});

	return tableString;
}
