import type { AppProps } from 'next/app';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import toast, { Toaster } from 'react-hot-toast';
import Head from 'next/head';
import { Router } from 'next/router';

import '../styles/globals.scss';
import 'tippy.js/dist/tippy.css';
import { useRpcQuery } from '../hooks/useQuery';
import { getConfig } from '../server/controllers/config';
import { useStreamingRpcQuery } from '../hooks/useStreamingQuery';
import { getHeartbeat } from '../server/controllers/heartbeat';

/**
 * Some toast decoration around next.js' async routing.
 */
Router.events.on('routeChangeStart', (_, { shallow }) => {
    if (!shallow) {
        const toastId = 'route-change';
        let done = false;
        const timer = setTimeout(() => {
            if (!done) {
                toast.loading(`Loading ...`, { id: toastId });
            }
        }, 100);
        const onSuccess = () => {
            unload();
            if (toastId) {
                toast.dismiss(toastId);
            }
        };
        const onError = err => {
            unload();
            if (err.cancelled) {
                toast.dismiss(toastId);
            } else {
                toast.error(`Failed to load new page.`, { id: toastId });
            }
        };
        const unload = () => {
            done = true;
            clearTimeout(timer);
            Router.events.off('routeChangeComplete', onSuccess);
            Router.events.off('routeChangeError', onError);
        };

        Router.events.on('routeChangeComplete', onSuccess);
        Router.events.on('routeChangeError', onError);
    }
});

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: true
        }
    }
});

function QueryDevtools() {
    const { data: config } = useRpcQuery(getConfig, {});
    if (!config?.showReactQueryDebugger) {
        return null;
    }
    return <ReactQueryDevtools />;
}

export default function MyApp({ Component, pageProps }: AppProps) {
    const { error } = useStreamingRpcQuery(
        getHeartbeat,
        {},
        {
            onResult() {}
            // onEnd() {
            //     toast.error('Connection to sidekick server was lost unexpectedly', { id: 'ws-connect' });
            // }
        }
    );
    // useEffect(() => {
    //     if (error) {
    //         toast.error(`Connection to sidekick server was lost: ${error}`, { id: 'ws-connect' });
    //     }
    // }, [error]);

    return (
        <>
            <Head>
                <link
                    rel={'icon'}
                    href={
                        'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡️</text></svg>'
                    }
                />
                <link
                    rel={'stylesheet'}
                    type={'text/css'}
                    data-name={'vs/editor/editor.main'}
                    href={'https://cdn.jsdelivr.net/npm/monaco-editor@0.25.2/min/vs/editor/editor.main.css'}
                />
            </Head>
            <QueryClientProvider client={queryClient}>
                <Toaster />
                <QueryDevtools />
                <Component {...pageProps} />
            </QueryClientProvider>
        </>
    );
}
