import type { AppProps } from 'next/app';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { Toaster } from 'react-hot-toast';
import Head from 'next/head';

import '../styles/globals.scss';
import {useRpcQuery} from "../hooks/useQuery";
import {getConfig} from "./api/config";

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
