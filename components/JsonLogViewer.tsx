import { TriangleDownIcon, TriangleRightIcon } from '@primer/octicons-react';
import * as React from 'react';
import { useMemo, useRef, useState } from 'react';
import { Monaco } from './Monaco';
import { Alert } from './AlertCard';
import { useLocalState } from '../hooks/useLocalState';
import classNames from 'classnames';
import { ErrorBoundary } from 'react-error-boundary';

const pinoLogLevels: Record<string, string> = {
	'10': 'trace',
	'20': 'debug',
	'30': 'info',
	'40': 'warn',
	'50': 'error',
	'60': 'fatal',
};

function getLogLevel(entry?: any): string {
	return String(pinoLogLevels[String(entry?.level)] ?? entry?.level ?? 'log');
}

function getLogTimestamp(entry?: any) {
	return new Date(entry?.time ?? entry?.createdAt).toLocaleString();
}

function getLogMessage(entry?: any) {
	try {
		return entry?.message ?? entry?.msg ?? JSON.stringify(entry);
	} catch {
		return '';
	}
}

function formatLogSummary(entry?: any) {
	try {
		if (entry?.level) {
			return `${getLogLevel(entry)}: ${getLogMessage(entry)}`;
		}
	} catch {}
	try {
		return getLogMessage(entry);
	} catch {}
	return JSON.stringify(entry);
}

const JsonLogEntry: React.FC<{ entry: unknown }> = ({ entry }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<li
			className={classNames('mb-2', { 'cursor-pointer': !isExpanded })}
			onClick={() => !isExpanded && setIsExpanded(true)}
		>
			<div className={'flex items-center justify-between'}>
				<p
					className={'flex items-center cursor-pointer'}
					onClick={() => isExpanded && setIsExpanded(false)}
				>
					<span className={'mr-2 flex items-center'}>
						{isExpanded ? <TriangleDownIcon /> : <TriangleRightIcon />}
					</span>
					<span>{formatLogSummary(entry)}</span>
				</p>
				<span className={'text-sm bg-slate-400 rounded p-1 text-black'}>
					{getLogTimestamp(entry)}
				</span>
			</div>
			{isExpanded && (
				<div className={'h-48 mt-2'}>
					<Monaco
						language={'json'}
						value={JSON.stringify(entry, null, '\t')}
						options={{ readOnly: true }}
					/>
				</div>
			)}
		</li>
	);
};

export const JsonLogViewer: React.FC<{ viewerId: string; logs: unknown[] }> = ({
	viewerId,
	logs,
}) => {
	const [inputQuery = 'return logs', setInputQuery] = useLocalState(
		`${viewerId}:log-filter`,
		String,
	);
	const { results, err } = useMemo(() => {
		try {
			const results = new Function('logs', inputQuery)(logs);
			if (Array.isArray(results)) {
				return { results, err: null };
			}
			return {
				results: null,
				err: `Filter must return an array (received ${typeof results})`,
			};
		} catch (err) {
			if (err instanceof SyntaxError) {
				return { results: null, err: null };
			}
			return { results: null, err };
		}
	}, [inputQuery, logs]);

	const resultsRef = useRef(logs);
	resultsRef.current = results ?? resultsRef.current ?? logs;

	return (
		<>
			{err && <Alert className={'mb-2'}>{String(err)}</Alert>}
			<div className={'h-24'}>
				<Monaco
					language={'javascript'}
					value={inputQuery}
					onChange={(evt) => setInputQuery(evt ?? inputQuery)}
				/>
			</div>
			<ul
				className={
					'list-none font-mono p-2 mt-4 rounded bg-zinc-700 text-white max-h-1/2 overflow-y-auto'
				}
			>
				{resultsRef.current.length === 0 &&
					(logs.length > 0 ? (
						<p>No logs match your filter.</p>
					) : (
						<p>No logs yet.</p>
					))}
				<ErrorBoundary
					resetKeys={resultsRef.current}
					fallback={<p>Failed to render logs, please check your filter.</p>}
				>
					{resultsRef.current.map((logEntry, idx) => (
						<JsonLogEntry key={idx} entry={logEntry} />
					))}
				</ErrorBoundary>
			</ul>
		</>
	);
};
