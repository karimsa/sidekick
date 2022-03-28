import * as React from 'react';
import { useRpcQuery } from '../hooks/useQuery';
import {
	getZombieProcessInfo,
	killProcesses,
} from '../server/controllers/servers';
import { useRpcMutation } from '../hooks/useMutation';
import { Alert, AlertCard } from './AlertCard';
import { Spinner } from './Spinner';
import { Code } from './Code';
import { Button } from './Button';

export const ZombieServiceControls: React.FC<{ serviceName: string }> = ({
	serviceName,
}) => {
	const { data: processInfo, error: errLoadingProcessInfo } = useRpcQuery(
		getZombieProcessInfo,
		{
			name: serviceName,
		},
	);
	const { mutate: performKill, isLoading: isKilling } =
		useRpcMutation(killProcesses);

	return (
		<AlertCard
			title={`'${serviceName}' is in an undefined state`}
			borderColor={'border-orange-600'}
		>
			<p>
				Sidekick has detected a process running and responding on this
				service&apos;s ports, but the process is not owned by sidekick.
			</p>
			{!errLoadingProcessInfo && !processInfo && (
				<p className={'flex items-center mt-5'}>
					<Spinner className={'text-black mr-2'} />
					<span>Locating zombie processes ...</span>
				</p>
			)}
			{errLoadingProcessInfo && (
				<Alert className={'mt-5'}>
					Failed to load process info: {String(errLoadingProcessInfo)}
				</Alert>
			)}
			{processInfo && (
				<>
					<Code>{JSON.stringify(processInfo, null, '\t')}</Code>

					<Button
						className={'mt-5'}
						loading={isKilling}
						onClick={() => {
							performKill({
								pids: processInfo.map((info) => info.pid),
							});
						}}
						variant={'danger'}
					>
						Force kill these processes
					</Button>
				</>
			)}
		</AlertCard>
	);
};
