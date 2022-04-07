import { withSidebar } from '../../components/Sidebar';
import { useExtension } from '../../hooks/useExtensions';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';
import { Alert, AlertCard } from '../../components/AlertCard';
import Head from 'next/head';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { Button } from '../../components/Button';
import { AlertFillIcon } from '@primer/octicons-react';
import { Spinner } from '../../components/Spinner';
import { Code } from '../../components/Code';

export default withSidebar(function ExtensionWrapper() {
	const router = useRouter();
	const { extensionId } = router.query;
	const { extension, error } = useExtension(
		Array.isArray(extensionId) ? extensionId[0] : extensionId,
	);
	const ExtensionFallback = useCallback(
		({ error, resetErrorBoundary }: FallbackProps) => {
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const [showStackTrace, setShowStackTrace] = useState(false);

			return (
				<AlertCard title={`The extension has crashed.`}>
					<p>
						Sorry, but the extension with the ID &quot;{extensionId}&quot; has
						crashed.
					</p>
					<Code>
						{String((showStackTrace ? error.stack : error.message) || error)}
					</Code>
					<Button onClick={() => resetErrorBoundary()} variant={'primary'}>
						Reload extension
					</Button>
					<Button
						variant={'secondary'}
						className={'ml-2'}
						onClick={() => setShowStackTrace(!showStackTrace)}
					>
						{showStackTrace ? 'Hide' : 'Show'} stacktrace
					</Button>
				</AlertCard>
			);
		},
		[extensionId],
	);

	if (error) {
		return (
			<AlertCard title={'Failed to load extension'}>
				<p>Error occurred while bundling your extension.</p>
				<Code>{String(error)}</Code>
			</AlertCard>
		);
	}
	if (!extension) {
		return (
			<p className={'text-white flex items-center'}>
				<Spinner className={'text-white mr-2'} />
				Loading ...
			</p>
		);
	}

	return (
		<>
			<Head>
				<title>{extension.name} | Sidekick</title>
			</Head>

			<ErrorBoundary FallbackComponent={ExtensionFallback}>
				{extension.warnings.map((warning) => (
					<Alert key={warning} bgColor={'bg-yellow-500 mb-5'}>
						<AlertFillIcon className={'mr-2'} />
						{warning}
					</Alert>
				))}

				<extension.Page />
			</ErrorBoundary>
		</>
	);
});
