import { withSidebar } from '../components/Sidebar';
import { useRpcQuery } from '../hooks/useQuery';
import { getConfig } from '../server/controllers/config';

export default withSidebar(function Home() {
	const { data: config } = useRpcQuery(getConfig, {});

	return (
		<div className={'h-full w-full flex flex-col items-center justify-center'}>
			<h1 className={'text-4xl text-white'} style={{ filter: 'saturate(0)' }}>
				⚡️ Welcome to Sidekick
			</h1>
			<p className={'text-xl text-white mt-5'}>
				Current project: {config?.projectName ?? '(loading)'}
			</p>
		</div>
	);
});
