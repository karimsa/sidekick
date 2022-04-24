import { Code } from './Code';
import { TriangleDownIcon, TriangleRightIcon } from '@primer/octicons-react';
import * as React from 'react';
import { useState } from 'react';

const pinoLogLevels: Record<string, string> = {
	'10': 'trace',
	'20': 'debug',
	'30': 'info',
	'40': 'warn',
	'50': 'error',
	'60': 'fatal',
};

function getLogLevel(entry: any): string {
	return String(pinoLogLevels[String(entry.level)] ?? entry.level ?? 'log');
}

function getLogTimestamp(entry: any) {
	return new Date(entry.time ?? entry.createdAt).toLocaleString();
}

function formatLogSummary(entry: any) {
	if (entry.level) {
		return `${getLogLevel(entry)}: ${
			entry.message ?? entry.msg ?? JSON.stringify(entry)
		}`;
	}
	return JSON.stringify(entry);
}

const JsonLogEntry: React.FC<{ entry: unknown }> = ({ entry }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<li className={'cursor-pointer'} onClick={() => setIsExpanded(!isExpanded)}>
			<Code className={'p-2'}>
				<div className={'flex items-center justify-between'}>
					<p className={'flex items-center'}>
						<span className={'mr-2 flex items-center'}>
							{isExpanded ? <TriangleDownIcon /> : <TriangleRightIcon />}
						</span>
						<span>{formatLogSummary(entry)}</span>
					</p>
					<span className={'text-sm bg-slate-400 rounded p-1'}>
						{getLogTimestamp(entry)}
					</span>
				</div>
				{isExpanded && <span>{JSON.stringify(entry, null, '\t')}</span>}
			</Code>
		</li>
	);
};

export const JsonLogViewer: React.FC<{ logs: unknown[] }> = ({ logs }) => {
	return (
		<ul>
			{logs.map((logEntry, idx) => (
				<JsonLogEntry key={idx} entry={logEntry} />
			))}
		</ul>
	);
};
