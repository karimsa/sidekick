import { withSidebar } from '../../components/Sidebar';
import { useExtensions } from '../../hooks/useExtensions';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import { Alert } from '../../components/Alert';
import Head from 'next/head';

export default withSidebar(function () {
    const router = useRouter();
    const { extensionId } = router.query;
    const { extensions, error } = useExtensions();
    const selectedExtension = useMemo(
        () => extensions?.find(extension => extension.id === extensionId),
        [extensionId, extensions]
    );

    if (error) {
        return <Alert title={'Failed to load extension'}>{String(error)}</Alert>;
    }
    if (!selectedExtension && extensions) {
        return (
            <Alert title={'Failed to load extension'}>Cannot find an extension with the ID &quot;{extensionId}</Alert>
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

            <Content />
        </>
    );
});
