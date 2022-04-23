import * as React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { withSidebar } from '../../components/Sidebar';
import {
	bulkServiceAction,
	getServerHealth,
	getService,
	getServiceLogs,
	getServiceProcessInfo,
	getServices,
	prepareStaleServices,
	restartDevServer,
	startService,
	stopService,
} from '../../server/controllers/servers';
import Head from 'next/head';
import { useRpcQuery } from '../../hooks/useQuery';
import { toast } from 'react-hot-toast';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import {
	useLazyStreamingRpcQuery,
	useStreamingRpcQuery,
} from '../../hooks/useStreamingQuery';
import { HealthStatus, isActiveStatus } from '../../utils/shared-types';
import { RpcOutputType } from '../../utils/http';
import { ServiceStatusBadge } from '../../components/ServiceStatusBadge';
import { ZombieServiceControls } from '../../components/ZombieServiceControls';
import { Button } from '../../components/Button';
import {
	LinkExternalIcon,
	NoEntryFillIcon,
	PlayIcon,
	StopIcon,
	ToolsIcon,
	XCircleFillIcon,
} from '@primer/octicons-react';
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
import { Spinner } from '../../components/Spinner';
import { BackgroundMutationButton } from '../../hooks/useBackgroundMutation';

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
		useMemo(
			() => ({
				name: serviceName,
			}),
			[serviceName],
		),
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
							'bg-slate-800': selectedServerName === serviceName,
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

const PrepareAllButton: React.FC = memo(function PrepareAllButton() {
	const { data, mutate: runPrepare } = useLazyStreamingRpcQuery(
		prepareStaleServices,
		(state, action) => {
			switch (action.type) {
				case 'open':
					return { isLoading: true, isComplete: false, output: '' };
				case 'data':
					return { ...state, output: state.output + action.data };
				case 'error':
					return {
						...state,
						isComplete: true,
						output: `${state.output}\n\nFailed to prepare: ${action.error}`,
					};
				case 'end':
					return {
						...state,
						isLoading: false,
						isComplete: true,
						output: `${state.output}\n\nSuccessfully prepare package.`,
					};
			}
		},
		{ isLoading: false, isComplete: false, output: '' },
		{ autoRetry: false },
	);
	const [isModalVisible, setModalVisible] = useState(false);
	useEffect(() => {
		if (data.isComplete) {
			toast.success(`Successfully prepared!`, {
				id: `prepare-all`,
				duration: 1e3,
				position: 'bottom-right',
			});
		}
	}, [data.isComplete]);

	return (
		<>
			<Button
				variant={'info'}
				className={'w-full'}
				size={'sm'}
				icon={<ToolsIcon />}
				loading={data.isLoading}
				onClick={() => {
					toast.loading(
						<div className={'flex items-center'}>
							<span>Preparing</span>
							<Button
								variant={'secondary'}
								className={'ml-2'}
								size={'sm'}
								onClick={() => setModalVisible(true)}
							>
								Logs
							</Button>
						</div>,
						{
							id: `prepare-all`,
							duration: Infinity,
							position: 'bottom-right',
						},
					);
					runPrepare({});
				}}
			>
				Prepare
			</Button>

			<Modal
				show={isModalVisible}
				onClose={() => setModalVisible(false)}
				fullHeight
			>
				<ModalTitle>Preparing all stale packages</ModalTitle>
				<ModalBody>
					<Monaco language={'logs'} value={`${data.output}\n`} />
				</ModalBody>
			</Modal>
		</>
	);
});

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
	const serviceTags = useMemo(() => {
		const builtinTags = ['running', 'all'];
		const customTags = [
			...new Set(services?.flatMap((service) => service.tags) ?? []),
		].sort();
		return [...builtinTags, ...customTags];
	}, [services]);

	const [showAllServices, setShowAllServices] = useState(false);
	const [visibleTag, setVisibleTag] = useState('running');
	const isServiceVisible = useCallback(
		(visibleTag: string, service: ServiceConfig) => {
			if (visibleTag === 'all') {
				return true;
			}
			if (visibleTag === 'running') {
				return (
					serviceStatuses[service.name]?.healthStatus !== HealthStatus.none
				);
			}
			return service.tags.includes(visibleTag);
		},
		[serviceStatuses],
	);
	const visibleServices = useMemo(
		() =>
			services?.flatMap((service) =>
				isServiceVisible(visibleTag, service) ? [service] : [],
			),
		[isServiceVisible, services, visibleTag],
	);
	const areAllVisibleServicesActive = useMemo(
		() =>
			visibleServices?.reduce(
				(isHealthy, service) =>
					isHealthy &&
					isActiveStatus(serviceStatuses[service.name]?.healthStatus),
				true,
			),
		[serviceStatuses, visibleServices],
	);

	const { mutate: performBulkAction, isLoading: isPerformingBulkAction } =
		useRpcMutation(bulkServiceAction, {
			onError(error: any, data) {
				toast.error(
					`Failed to ${data.action} services: ${error.message ?? error}`,
				);
			},
		});

	debugHooksChanged('ServiceList', {
		serviceStatuses,
		setServiceStatuses,
		services,
		showAllServices,
		setShowAllServices,
	});

	return (
		<ul
			className={'overflow-auto h-full'}
			style={{
				maxHeight: 'calc(100vh - (2*1.25rem))',
			}}
		>
			{serviceTags && visibleServices && (
				<div>
					<div className={'p-5'}>
						<Select
							id={'service-tag-view'}
							value={visibleTag}
							onChange={setVisibleTag}
							options={serviceTags.map((tag) => ({
								label: `${startCase(tag)} services`,
								value: tag,
							}))}
						/>
					</div>

					<div className={'px-5 pb-2 space-x-2 flex'}>
						<Tooltip
							content={`Start ${visibleTag.toLowerCase()} services`}
							disabled={areAllVisibleServicesActive}
						>
							<Button
								className={'w-full'}
								variant={'primary'}
								size={'sm'}
								disabled={areAllVisibleServicesActive}
								loading={isPerformingBulkAction}
								icon={<PlayIcon />}
								onClick={() =>
									performBulkAction({
										action: 'start',
										serviceNames: visibleServices.map(
											(service) => service.name,
										),
										targetEnvironment: 'local',
										environment: {},
									})
								}
							>
								Start
							</Button>
						</Tooltip>

						<Tooltip content={`Stop ${visibleTag.toLowerCase()} services`}>
							<Button
								variant={'danger'}
								size={'sm'}
								className={'w-full'}
								loading={isPerformingBulkAction}
								icon={<StopIcon />}
								onClick={() =>
									performBulkAction({
										action: 'stop',
										serviceNames: visibleServices.map(
											(service) => service.name,
										),
										targetEnvironment: undefined,
										environment: undefined,
									})
								}
							>
								Stop
							</Button>
						</Tooltip>
					</div>

					<div className={'px-5 pb-5 space-x-2 flex'}>
						<Tooltip content={`Prepare ${visibleTag.toLowerCase()} services`}>
							<PrepareAllButton />
						</Tooltip>

						<Tooltip content={`Pause ${visibleTag.toLowerCase()} services`}>
							<Button
								disabled={true}
								variant={'warning'}
								className={'w-full'}
								size={'sm'}
								loading={isPerformingBulkAction}
								icon={<NoEntryFillIcon />}
								onClick={() =>
									performBulkAction({
										action: 'pause',
										serviceNames: visibleServices.map(
											(service) => service.name,
										),
										targetEnvironment: undefined,
										environment: undefined,
									})
								}
							>
								Pause
							</Button>
						</Tooltip>
					</div>
				</div>
			)}
			{visibleServices?.map((service) => (
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
			))}
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

const ServicePrepareButton: React.FC<{ serviceName: string }> = ({
	serviceName,
}) => {
	return (
		<BackgroundMutationButton
			variant={'info'}
			className={'ml-2'}
			icon={<ToolsIcon />}
			toastId={`prepare-${serviceName}`}
			logsTitle={`Preparing: ${serviceName}`}
			loadingMessage={`Preparing`}
			successMessage={`Successfully prepared ${serviceName}!`}
			handler={{ methodName: 'prepareService' } as any}
			inputData={useMemo(() => ({ name: serviceName }), [serviceName])}
		>
			Prepare
		</BackgroundMutationButton>
	);
};

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
		useMemo(
			() => ({
				name: serviceName,
				devServer: devServerName,
			}),
			[devServerName, serviceName],
		),
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
					<div className={'flex items-center'}>
						<ServiceStartButton serviceName={selectedServerName} />
						<ServicePrepareButton serviceName={selectedServerName} />
					</div>
				)}

				{isActiveStatus(selectedServerStatus.healthStatus) && (
					<div>
						{serviceConfig &&
							serviceConfig.ports.flatMap((port) =>
								port.type === 'http' ? (
									<div key={port.port} className={'mb-5'}>
										<a
											href={`http://localhost:${port.port}/`}
											target={'_blank'}
											className={
												'text-blue-500 hover:text-blue-700 hover:border-b border-blue-700 pb-1'
											}
											rel="noreferrer"
										>
											<LinkExternalIcon />
											<span className={'ml-2'}>
												Open http://localhost:{port.port}/
											</span>
										</a>
									</div>
								) : null,
							)}

						<div>
							<ServiceStopButton serviceName={selectedServerName} />
						</div>
					</div>
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

	const { data: services, error } = useRpcQuery(getServices, {});

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

					{!services && !error && (
						<div className={'flex items-center justify-center w-full'}>
							<div className={'flex items-center'}>
								<Spinner className={'text-white'} />
								<span className={'ml-4 text-white text-lg'}>
									Fetching services ...
								</span>
							</div>
						</div>
					)}

					{services && services.length === 0 && (
						<div className={'flex items-center justify-center w-full'}>
							<AlertCard title={'No servers found.'}>
								Looks like your project is not a lerna/yarn workspace, or is
								empty. Create some packages that are visible to lerna/yarn to
								get started.
							</AlertCard>
						</div>
					)}

					{!error && services && services.length > 0 && (
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
