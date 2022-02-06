import { withSidebar } from '../../components/Sidebar';
import { useExtensions } from '../../hooks/useExtensions';
import { useRouter } from 'next/router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, AlertCard } from '../../components/AlertCard';
import Head from 'next/head';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { Button } from '../../components/Button';
import { AlertFillIcon } from '@primer/octicons-react';
import { Spinner } from '../../components/Spinner';

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
                <AlertCard title={`The extension has crashed.`}>
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
                </AlertCard>
            );
        },
        [extensionId]
    );

    if (error) {
        return <AlertCard title={'Failed to load extension'}>{String(error)}</AlertCard>;
    }
    if (!selectedExtension && extensions) {
        return (
            <AlertCard title={'Failed to load extension'}>
                Cannot find an extension with the ID &quot;{extensionId}&quot;
            </AlertCard>
        );
    }
    if (!selectedExtension) {
        return (
            <p className={'text-white flex items-center'}>
                <Spinner className={'text-white mr-2'} />
                Loading ...
            </p>
        );
    }

    const Content = selectedExtension.Page;
    return (
        <>
            <Head>
                <title>{selectedExtension.title} | Sidekick</title>
            </Head>

            <ErrorBoundary FallbackComponent={ExtensionFallback}>
                {selectedExtension.warnings.map(warning => (
                    <Alert key={warning} bgColor={'bg-yellow-500 mb-5'}>
                        <AlertFillIcon className={'mr-2'} />
                        {warning}
                    </Alert>
                ))}

                <Content />
            </ErrorBoundary>
        </>
    );
});
