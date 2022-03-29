import * as React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { withSidebar } from '../../components/Sidebar';
import {
	getServerHealth,
	getServers,
	getService,
	getServiceLogs,
	getServiceProcessInfo,
	restartDevServer,
	getServices,
	getServiceTags,
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
import startCase from 'lodash/startCase';
import type { ServiceConfig } from '../../services/service-list';

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
	healthStatus: HealthStatus;
	onStatusUpdate(status: RpcOutputType<typeof getServerHealth>): void;
}> = ({ serviceName, healthStatus, onStatusUpdate }) => {
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
		getServices,
		{},
		{
			onError(error) {
				toast.error(String(error), { id: 'get-servers' });
			},
		},
	);
	const { data: serviceTags } = useRpcQuery(
		getServiceTags,
		{},
		{
			onError(error: any) {
				toast.error(`Failed to fetch service tags: ${error.message ?? error}`, {
					id: 'get-service-tags',
				});
			},
		},
	);

	const [showAllServices, setShowAllServices] = useState(false);
	const [visibleTag, setVisibleTag] = useState('all');
	const isServiceVisible = useCallback(
		(visibleTag: string, service: ServiceConfig) => {
			if (visibleTag === 'all') {
				return true;
			}
			if (visibleTag === 'running') {
				return isActiveStatus(
					serviceStatuses[service.name]?.healthStatus ?? HealthStatus.none,
				);
			}
			return service.tags.includes(visibleTag);
		},
		[serviceStatuses],
	);

	debugHooksChanged('ServiceList', {
		serviceStatuses,
		setServiceStatuses,
		services,
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
			{serviceTags && (
				<div className={'p-5'}>
					<Select
						id={'service-tag-view'}
						value={visibleTag}
						onChange={setVisibleTag}
						options={['all', 'running', ...serviceTags].map((tag) => ({
							label: `${startCase(tag)} services`,
							value: tag,
						}))}
					/>
				</div>
			)}
			{services?.map(
				(service) =>
					isServiceVisible(visibleTag, service) && (
						<ServiceListEntry
							key={service.name}
							serviceName={service.name}
							healthStatus={
								serviceStatuses[service.name]?.healthStatus ?? HealthStatus.none
							}
							onStatusUpdate={(status) =>
								!isEqual(serviceStatuses[service.name], status) &&
								setServiceStatuses({
									...serviceStatuses,
									[service.name]: status,
								})
							}
						/>
					),
			)}
		</ul>
	);
});

const ServiceEditButton: React.FC<{
	serviceName: string;
	devServerName: string;
}> = memo(function ServiceEditButton({ serviceName, devServerName }) {
	const { mutate: restart, isLoading: isStarting } = useRpcMutation(
		restartDevServer,
		{
			onError(error: any) {
				toast.error(
					`Failed to restart ${devServerName}: ${error.message ?? error}`,
				);
			},
		},
	);
	const { data: processInfo, error } = useRpcQuery(getServiceProcessInfo, {
		serviceName,
		devServer: devServerName,
	});

	const [modalOpen, setModalOpen] = useState(false);
	const [resetLogs, setResetLogs] = useState(false);
	const [envOverrides, setEnvOverrides] = useState('{}');
	useEffect(() => {
		if (processInfo) {
			setEnvOverrides(JSON.stringify(processInfo.environment, null, '\t'));
		}
	}, [processInfo]);

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
			<Button
				className={'mb-5'}
				variant={'warning'}
				disabled={!!error}
				loading={isStarting}
				icon={<PlayIcon />}
				onClick={() => setModalOpen(true)}
			>
				Edit and restart
			</Button>

			<Modal show={modalOpen} onClose={() => setModalOpen(false)}>
				<ModalTitle>
					Edit and restart:{' '}
					<span className={'bg-slate-400 rounded p-1'}>{devServerName}</span> in{' '}
					<span className={'bg-slate-400 rounded p-1'}>{serviceName}</span>
				</ModalTitle>
				<ModalBody>
					<form
						className={'flex flex-col space-y-5'}
						onSubmit={(evt) => {
							evt.preventDefault();
							restart({
								serviceName,
								devServer: devServerName,
								resetLogs,
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
								Environment variables:
							</label>
							<div className={'h-96'}>
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

						<div>
							<input
								id={'resetLogs'}
								type={'checkbox'}
								className={'m-3 inline-block'}
								checked={resetLogs}
								onChange={(evt) => setResetLogs(evt.target.checked)}
							/>
							<label htmlFor={'resetLogs'}>Reset logs</label>
						</div>

						<div className="flex justify-center">
							<Button
								type={'submit'}
								variant={'warning'}
								icon={<PlayIcon />}
								disabled={!isEnvOverridesValid}
							>
								Edit and restart
							</Button>
						</div>
					</form>
				</ModalBody>
			</Modal>
		</>
	);
});

const ServiceStartButton: React.FC<{ serviceName: string }> = memo(
	function ServiceStartButton({ serviceName }) {
		const [menuOpen, setMenuOpen] = useState(false);
		const { data: config, error } = useRpcQuery(getConfig, {});
		const { mutate: start, isLoading: isStarting } = useRpcMutation(
			startService,
			{
				onError(error: any) {
					toast.error(
						`Failed to start ${serviceName}: ${error.message ?? error}`,
					);
				},
			},
		);

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

	return (
		<>
			<ServiceEditButton
				serviceName={serviceName}
				devServerName={devServerName}
			/>
			<Monaco language={'log'} value={data} />
		</>
	);
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
