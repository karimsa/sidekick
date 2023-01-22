import { useRouter } from 'next/router';
import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';

import { withSidebar } from '../../components/Sidebar';
import { Spinner } from '../../components/Spinner';
import { AlertCard } from '../../components/AlertCard';
import { Code } from '../../components/Code';

export default withSidebar(
	function ExtensionWrapper() {
		const router = useRouter();
		const { extensionId } = router.query;
		const initIframeTarget = useMemo(
			() =>
				global.window
					? `http://${window.location.hostname}:9010/extension/${extensionId}/renderer${window.location.search}`
					: ``,
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[extensionId],
		);
		const iframeRef = useRef<HTMLIFrameElement | null>(null);
		const [isLoading, setLoading] = useState(false);
		const [error, setError] = useState<{
			message: string;
			stack: string;
			cause?: string;
		} | null>(null);
		const [title, setTitle] = useState();

		useEffect(() => {
			const onMessage = (message: MessageEvent) => {
				try {
					const { data } = message;
					switch (data.type) {
						case 'locationUpdate':
							router.push(
								{
									pathname: window.location.pathname,
									search: new URL(data.location).search,
								},
								undefined,
								{ shallow: true },
							);
							break;
						case 'titleUpdate':
							setTitle(data.title);
							break;
						case 'buildFailed':
							setError({
								message: data.message,
								stack: data.stack,
								cause: data.cause,
							});
							break;
					}
				} catch {}
			};

			window.addEventListener('message', onMessage);
			return () => window.removeEventListener('message', onMessage);
		}, [router]);

		return (
			<>
				<Head>
					<title>{title ?? extensionId} | Sidekick</title>
				</Head>

				{isLoading && (
					<p className={'text-white flex items-center'}>
						<Spinner className={'text-white mr-2'} />
						Loading ...
					</p>
				)}
				{global.window && extensionId && !error && (
					<iframe
						ref={iframeRef}
						className={`w-full h-screen`}
						src={initIframeTarget}
						onLoad={() => setLoading(false)}
						frameBorder={0}
					/>
				)}
				{error && (
					<div className={'w-full'}>
						<AlertCard title={`Extension '${extensionId}' failed to build`}>
							<Code>{error.message}</Code>
							<Code>{error.stack}</Code>
							{error.cause && <Code>{error.cause}</Code>}
						</AlertCard>
					</div>
				)}
			</>
		);
	},
	{ noPadding: true },
);
