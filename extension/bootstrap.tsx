import React from 'react';
import ReactDOM from 'react-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { XCircleFillIcon } from '@primer/octicons-react';

// This gets filled by the bundler
// @ts-ignore
import { Page } from 'sidekick-extension-code';
// @ts-ignore
import { config } from 'sidekick-extension-config';


/* Without setting margin=0 here, the iframe takes up more space than
 * it should and produces a horizontal scroll.
 */
const style = document.createElement('style');
style.innerText = `
	html, body {
		background: rgb(51 65 85);
	}

	body {
		padding: 20px;
		margin: 0px;
	}
`;
document.head.appendChild(style);

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,
		},
	},
});

let lastReportedLocation = '';
let lastReportedTitle = '';

setInterval(() => {
	console.dir({ lastReportedLocation, current: window.location.href });
	if (lastReportedLocation !== window.location.href) {
		window.parent.postMessage(
			{
				type: 'locationUpdate',
				location: window.location.href,
			},
			'*',
		);
		lastReportedLocation = window.location.href;
	}
	if (lastReportedTitle !== document.title) {
		window.parent.postMessage(
			{
				type: 'titleUpdate',
				title: document.title,
			},
			'*',
		);
		lastReportedTitle = document.title;
	}
}, 1000);

const ExtensionErrorBoundary: React.FC<FallbackProps> = ({ error }) => (
	<div
		style={{
			background: 'white',
			padding: '1.25rem',
			borderTop: 'solid 4px rgb(234, 88, 12)',
			borderRadius: '4px',
			fontFamily: 'sans-serif',
		}}
	>
		<p
			style={{
				color: 'rgb(234, 88, 12)',
				fontSize: '1rem',
				marginBottom: '1.25rem',
			}}
		>
			<XCircleFillIcon />
			<span
				style={{
					marginLeft: '0.5rem',
				}}
			>
				The extension &quot;{config.name}&quot; has crashed.
			</span>
		</p>
		<pre
			style={{
				padding: '1rem',
				borderRadius: '4px',
				fontFamily: 'monospace',
				background: 'rgb(209, 213, 219)',
			}}
		>
			<code>{String(error?.message ?? error).split(/\n/)[0]}</code>
		</pre>
		<pre
			style={{
				padding: '1rem',
				borderRadius: '4px',
				fontFamily: 'monospace',
				background: 'rgb(209, 213, 219)',
				overflow: 'auto',
			}}
		>
			<code>{String(error?.stack ?? error)}</code>
		</pre>

		<div>
			<button type="button" onClick={() => location.reload()}>
				Reload extension
			</button>
		</div>
	</div>
);

ReactDOM.render(
	<QueryClientProvider client={queryClient}>
		<ErrorBoundary FallbackComponent={ExtensionErrorBoundary}>
			<Page />
		</ErrorBoundary>
	</QueryClientProvider>,
	document.getElementById('app'),
);
