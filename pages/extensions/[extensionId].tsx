import { withSidebar } from '../../components/Sidebar';
import { useExtensions } from '../../hooks/useExtensions';
import { useRouter } from 'next/router';
import { useCallback, useMemo, useState } from 'react';
import { Alert } from '../../components/Alert';
import Head from 'next/head';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { Button } from '../../components/Button';

export default withSidebar(function () {
    const router = useRouter();
    const { extensionId } = router.query;
    const { extensions, error } = useExtensions();
    const selectedExtension = useMemo(
        () => extensions?.find(extension => extension.id === extensionId),
        [extensionId, extensions]
    );
    const ExtensionFallback = useCallback(
        ({ error, resetErrorBoundary }: FallbackProps) => {
            const [showStackTrace, setShowStackTrace] = useState(false);

            return (
                <Alert title={`The extension has crashed.`}>
                    <p>Sorry, but the extension with the ID &quot;{extensionId}&quot; has crashed.</p>
                    <code>
                        <pre className={'font-mono my-5 p-5 rounded bg-gray-300 break-all overflow-auto'}>
                            {String((showStackTrace ? error.stack : error.message) || error)}
                        </pre>
                    </code>
                    <Button onClick={() => resetErrorBoundary()} variant={'primary'}>
                        Reload extension
                    </Button>
                    <Button variant={'secondary'} className={'ml-2'} onClick={() => setShowStackTrace(!showStackTrace)}>
                        {showStackTrace ? 'Hide' : 'Show'} stacktrace
                    </Button>
                </Alert>
            );
        },
        [extensionId]
    );

    if (error) {
        return <Alert title={'Failed to load extension'}>{String(error)}</Alert>;
    }
    if (!selectedExtension && extensions) {
        return (
            <Alert title={'Failed to load extension'}>
                Cannot find an extension with the ID &quot;{extensionId}&quot;
            </Alert>
        );
    }
    if (!selectedExtension) {
        return <p>Loading ...</p>;
    }

    const Content = selectedExtension.Page;
    return (
        <>
            <Head>
                <title>{selectedExtension.config.title} | Sidekick</title>
            </Head>

            <ErrorBoundary FallbackComponent={ExtensionFallback}>
                <Content />
            </ErrorBoundary>
        </>
    );
});
