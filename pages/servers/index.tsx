import * as React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { withSidebar } from '../../components/Sidebar';
import {
	getServerHealth,
	getServers,
	getService,
	getServiceLogs,
	startService,
	stopService,
} from '../../server/controllers/servers';
import Head from 'next/head';
import { useRpcQuery } from '../../hooks/useQuery';
import { toast } from 'react-hot-toast';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { useStreamingRpcQuery } from '../../hooks/useStreamingQuery';
import { HealthStatus, isActiveStatus } from '../../utils/shared-types';
import { RpcOutputType } from '../../utils/http';
import { Toggle } from '../../components/Toggle';
import { ServiceStatusBadge } from '../../components/ServiceStatusBadge';
import { ZombieServiceControls } from '../../components/ZombieServiceControls';
import { Button } from '../../components/Button';
import { PlayIcon, StopIcon, XCircleFillIcon } from '@primer/octicons-react';
import {
	Dropdown,
	DropdownButton,
	DropdownContainer,
} from '../../components/Dropdown';
import { getConfig } from '../../server/controllers/config';
import { useRpcMutation } from '../../hooks/useMutation';
import Tooltip from '@tippyjs/react';
import { Modal, ModalBody, ModalTitle } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Monaco } from '../../components/Monaco';
import { Tab, Tabs, TabView } from '../../components/Tabs';
import { AlertCard } from '../../components/AlertCard';
import { Code } from '../../components/Code';
import { assertUnreachable } from '../../utils/util-types';
import { debugHooksChanged } from '../../hooks/debug-hooks';
import isEqual from 'lodash/isEqual';

function useServerName() {
	const router = useRouter();
	const { scopedName, serverName } = router.query;

	if (scopedName) {
		return `${serverName}/${scopedName}`;
	}
	if (serverName) {
		return String(serverName);
	}
}

const ServiceListEntry: React.FC<{
	serviceName: string;
	showAllServices: boolean;
	healthStatus: HealthStatus;
	onStatusUpdate(status: RpcOutputType<typeof getServerHealth>): void;
}> = ({ serviceName, showAllServices, healthStatus, onStatusUpdate }) => {
	const selectedServerName = useServerName();
	const { data } = useStreamingRpcQuery(
		getServerHealth,
		{
			name: serviceName,
		},
		useCallback(
			(
				state: {
					healthStatus: HealthStatus;
					version: string;
					error: string | null;
				},
				action,
			) => {
				switch (action.type) {
					case 'open':
						return { ...(state as any), error: null };
					case 'data':
						return { ...action.data, error: null };
					case 'error':
						return {
							healthStatus: HealthStatus.failing,
							version: state.version ?? '(unknown)',
							error: action.error,
						};
					case 'end':
						return {
							healthStatus: HealthStatus.none,
							version: state.version,
							error: null,
						};
					default:
						assertUnreachable(action);
				}
			},
			[],
		),
		{ healthStatus: HealthStatus.none, version: '(unknown)', error: null },
	);

	const statusUpdateRef = useRef(onStatusUpdate);
	statusUpdateRef.current = onStatusUpdate;

	useEffect(() => {
		statusUpdateRef.current(data);
	}, [data]);

	if (
		!showAllServices &&
		selectedServerName !== serviceName &&
		healthStatus === HealthStatus.none
	) {
		return null;
	}
	return (
		<li>
			<Link href={`/servers/${serviceName}`} passHref>
				<a
					className={classNames(
						'text-white p-4 hover:bg-slate-600 block flex items-center justify-between',
						{
							'bg-emerald-700': selectedServerName === serviceName,
						},
					)}
				>
					<span>{serviceName}</span>
					<ServiceStatusBadge
						status={healthStatus}
						error={data.error ?? undefined}
					/>
				</a>
			</Link>
		</li>
	);
};

const ServiceList: React.FC<{
	serviceStatuses: Record<string, RpcOutputType<typeof getServerHealth>>;
	setServiceStatuses(
		statuses: Record<string, RpcOutputType<typeof getServerHealth>>,
	): void;
}> = memo(function ServiceList({ serviceStatuses, setServiceStatuses }) {
	const { data: services } = useRpcQuery(
		getServers,
		{},
		{
			onError(error) {
				toast.error(String(error), { id: 'get-servers' });
			},
		},
	);

	const numHiddenServices = useMemo(
		() =>
			Object.values(serviceStatuses).reduce((numHiddenServices, status) => {
				return (
					numHiddenServices +
					(status.healthStatus === HealthStatus.none ? 1 : 0)
				);
			}, 0),
		[serviceStatuses],
	);

	const [showAllServices, setShowAllServices] = useState(false);

	debugHooksChanged('ServiceList', {
		serviceStatuses,
		setServiceStatuses,
		services,
		numHiddenServices,
		showAllServices,
		setShowAllServices,
	});

	return (
		<ul
			className={'overflow-auto'}
			style={{
				maxHeight: 'calc(100vh - (2*1.25rem))',
			}}
		>
			{numHiddenServices > 0 && (
				<div className={'text-slate-600 p-4 flex items-center justify-between'}>
					<span>
						{showAllServices
							? `All services are visible.`
							: `${numHiddenServices} non-running services are hidden.`}
					</span>
					<Toggle value={showAllServices} onChange={setShowAllServices} />
				</div>
			)}
			{services?.map((serviceName) => (
				<ServiceListEntry
					key={serviceName}
					serviceName={serviceName}
					showAllServices={showAllServices}
					healthStatus={
						serviceStatuses[serviceName]?.healthStatus ?? HealthStatus.none
					}
					onStatusUpdate={(status) =>
						!isEqual(serviceStatuses[serviceName], status) &&
						setServiceStatuses({
							...serviceStatuses,
							[serviceName]: status,
						})
					}
				/>
			))}
		</ul>
	);
});

const ServiceStartButton: React.FC<{ serviceName: string }> = memo(
	function ServiceStartButton({ serviceName }) {
		const [menuOpen, setMenuOpen] = useState(false);
		const { data: config, error } = useRpcQuery(getConfig, {});
		const { mutate: start, isLoading: isStarting } =
			useRpcMutation(startService);

		const [modalOpen, setModalOpen] = useState(false);
		const [targetEnvironment, setTargetEnvironment] = useState('');
		const [envOverrides, setEnvOverrides] = useState('{}');
		const isEnvOverridesValid = useMemo(() => {
			try {
				JSON.parse(envOverrides);
				return true;
			} catch {
				return false;
			}
		}, [envOverrides]);

		return (
			<>
				<DropdownContainer>
					<Button
						variant={'primary'}
						disabled={!!error}
						loading={isStarting}
						icon={<PlayIcon />}
						onClick={() => setMenuOpen(!menuOpen)}
					>
						Start dev servers
					</Button>

					<Dropdown
						show={menuOpen && !error}
						onClose={() => setMenuOpen(false)}
					>
						{config &&
							Object.keys(config.environments).map((env) => (
								<Tooltip key={env} content={String(error)} disabled={!error}>
									<DropdownButton
										className={'text-sm'}
										onClick={() => {
											start({
												name: serviceName,
												targetEnvironment: env,
												environment: {},
											});
											setMenuOpen(false);
										}}
									>
										Start in {env}
									</DropdownButton>
								</Tooltip>
							))}
						<DropdownButton
							className={'text-sm'}
							onClick={() => {
								setModalOpen(true);
								setMenuOpen(false);
							}}
						>
							More options
						</DropdownButton>
					</Dropdown>
				</DropdownContainer>

				<Modal show={modalOpen} onClose={() => setModalOpen(false)}>
					<ModalTitle>
						Start{' '}
						<span className={'bg-slate-400 rounded p-1'}>{serviceName}</span>{' '}
						dev servers
					</ModalTitle>
					<ModalBody>
						<form
							className={'flex flex-col space-y-5'}
							onSubmit={(evt) => {
								evt.preventDefault();
								start({
									name: serviceName,
									targetEnvironment,
									environment: JSON.parse(envOverrides),
								});
								setModalOpen(false);
							}}
						>
							<div>
								<label
									htmlFor={'targetEnvironment'}
									className={'mr-2 w-full block mb-3'}
								>
									Target environment:
								</label>
								<Select
									className={'w-full'}
									id={'targetEnvironment'}
									disabled={!config}
									options={
										config
											? Object.keys(config.environments).map((env) => ({
													label: env,
													value: env,
											  }))
											: []
									}
									value={targetEnvironment}
									onChange={setTargetEnvironment}
								/>
							</div>

							<div>
								<label
									htmlFor={'targetEnvironment'}
									className={'mr-2 w-full block mb-3'}
								>
									Environment overrides:
								</label>
								<div className={'h-24'}>
									<Monaco
										language={'json'}
										value={envOverrides}
										onChange={(value) => setEnvOverrides(value ?? '{}')}
									/>
								</div>
								{!isEnvOverridesValid && (
									<p className={'text-xs text-red-700 flex items-center pt-2'}>
										<XCircleFillIcon />
										<span className={'ml-1'}>Invalid JSON.</span>
									</p>
								)}
							</div>

							<div className="flex justify-center">
								<Button
									type={'submit'}
									variant={'primary'}
									icon={<PlayIcon />}
									disabled={!isEnvOverridesValid}
								>
									Start dev servers
								</Button>
							</div>
						</form>
					</ModalBody>
				</Modal>
			</>
		);
	},
);

const ServiceStopButton: React.FC<{ serviceName: string }> = memo(
	function ServiceStopButton({ serviceName }) {
		const { mutate: stop, isLoading } = useRpcMutation(stopService, {
			onError: (error) => {
				toast.error(String(error));
			},
		});

		return (
			<Button
				variant={'danger'}
				loading={isLoading}
				icon={<StopIcon />}
				onClick={() => stop({ name: serviceName })}
			>
				Stop servers
			</Button>
		);
	},
);

const ServiceLogs: React.FC<{
	serviceName: string;
	devServerName: string;
}> = ({ serviceName, devServerName }) => {
	const { data } = useStreamingRpcQuery(
		getServiceLogs,
		{
			name: serviceName,
			devServer: devServerName,
		},
		useCallback((state: string, action) => {
			switch (action.type) {
				case 'open':
					return '';
				case 'data':
					return state + action.data;
				case 'error':
					return `${state}\n\nLog stream errored out: ${action.error}`;
				case 'end':
					return `${state}\n\nLogs disconnected.`;
			}
		}, []),
		'',
	);

	return <Monaco language={'log'} value={data} />;
};

const ServiceControlPanel: React.FC<{
	serviceStatuses: Record<string, RpcOutputType<typeof getServerHealth>>;
}> = ({ serviceStatuses }) => {
	const selectedServerName = useServerName()!;
	const selectedServerStatus = serviceStatuses[selectedServerName] ?? {
		healthStatus: HealthStatus.none,
		version: '(unknown)',
	};

	const { data: serviceConfig, error } = useRpcQuery(
		getService,
		{ name: selectedServerName },
		{
			enabled: isActiveStatus(selectedServerStatus.healthStatus),
		},
	);

	return (
		<>
			<div className="flex items-center mb-5">
				<h1 className={'text-2xl text-white font-bold'}>
					{selectedServerName}
				</h1>
				<span className={'rounded bg-slate-700 text-xs text-white p-1 ml-2'}>
					v{String(selectedServerStatus.version)}
				</span>
			</div>

			<Tabs>
				<Tab href={`/servers/${selectedServerName}`}>Controls</Tab>
				{isActiveStatus(selectedServerStatus.healthStatus) &&
					serviceConfig &&
					Object.keys(serviceConfig.devServers).map((devServer) => (
						<Tab
							key={devServer}
							href={`/servers/${selectedServerName}/logs/${devServer}`}
						>
							{devServer}
						</Tab>
					))}
			</Tabs>

			{error && (
				<AlertCard title={'Failed to load service info.'}>
					Sidekick failed to load the service information for{' '}
					{selectedServerName}.<Code>{String(error)}</Code>
				</AlertCard>
			)}

			<TabView href={`/servers/${selectedServerName}`}>
				{(selectedServerStatus.healthStatus === HealthStatus.none ||
					selectedServerStatus.healthStatus === HealthStatus.stale) && (
					<ServiceStartButton serviceName={selectedServerName} />
				)}

				{isActiveStatus(selectedServerStatus.healthStatus) && (
					<ServiceStopButton serviceName={selectedServerName} />
				)}

				{selectedServerStatus.healthStatus === HealthStatus.zombie && (
					<ZombieServiceControls serviceName={selectedServerName} />
				)}
			</TabView>

			{isActiveStatus(selectedServerStatus.healthStatus) &&
				serviceConfig &&
				Object.keys(serviceConfig.devServers).map((devServer) => (
					<TabView
						key={devServer}
						href={`/servers/${selectedServerName}/logs/${devServer}`}
					>
						<ServiceLogs
							serviceName={selectedServerName}
							devServerName={devServer}
						/>
					</TabView>
				))}
		</>
	);
};

export default withSidebar(function Servers() {
	const [serviceStatuses, setServiceStatuses] = useState<
		Record<string, RpcOutputType<typeof getServerHealth>>
	>({});
	const selectedServerName = useServerName();

	const { data: servers, error } = useRpcQuery(getServers, {});

	return (
		<>
			<Head>
				<title>Servers | Sidekick</title>
			</Head>

			<div className={'flex-auto'}>
				<div className={'bg-slate-900 rounded h-full flex'}>
					{error && (
						<div className={'flex items-center justify-center w-full'}>
							<AlertCard title={'Failed to load servers list'}>
								The servers list could not be loaded.
								<Code>{String(error)}</Code>
							</AlertCard>
						</div>
					)}

					{servers && servers.length === 0 && (
						<div className={'flex items-center justify-center w-full'}>
							<AlertCard title={'No servers found.'}>
								Looks like your project is not a lerna/yarn workspace, or is
								empty. Create some packages that are visible to lerna/yarn to
								get started.
							</AlertCard>
						</div>
					)}

					{!error && servers && servers.length > 0 && (
						<>
							<div className={'w-1/4'}>
								<ServiceList
									serviceStatuses={serviceStatuses}
									setServiceStatuses={setServiceStatuses}
								/>
							</div>

							{selectedServerName && (
								<div className={'w-3/4 p-5'}>
									<ServiceControlPanel serviceStatuses={serviceStatuses} />
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</>
	);
});
