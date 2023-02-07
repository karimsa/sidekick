import type { AppProps } from 'next/app';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import toast, { Toaster } from 'react-hot-toast';
import { Router } from 'next/router';

import '../styles/globals.scss';
import 'tippy.js/dist/tippy.css';
import { useRpcQuery } from '../hooks/useQuery';
import { getConfig } from '../server/controllers/config';
import { CommandPalette } from '../components/CommandPalette';
import { LogWindowManager } from '../hooks/useLogWindow';

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
		const onError = (err: { cancelled: boolean }) => {
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
			refetchOnWindowFocus: true,
		},
	},
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
		<QueryClientProvider client={queryClient}>
			<Toaster />
			<QueryDevtools />
			<CommandPalette>
				<LogWindowManager>
					<Component {...pageProps} />
				</LogWindowManager>
			</CommandPalette>
		</QueryClientProvider>
	);
}
