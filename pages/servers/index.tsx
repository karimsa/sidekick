import * as React from 'react';
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useState,
	forwardRef,
} from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { toast } from 'react-hot-toast';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import {
	LinkExternalIcon,
	NoEntryFillIcon,
	NoEntryIcon,
	PlayIcon,
	StopIcon,
	TerminalIcon,
	ToolsIcon,
	TrashIcon,
	XCircleFillIcon,
} from '@primer/octicons-react';
import Tooltip from '@tippyjs/react';
import startCase from 'lodash/startCase';
import { v4 as uuid } from 'uuid';

import { withSidebar } from '../../components/Sidebar';
import {
	bulkServiceAction,
	getService,
	getServiceLogs,
	getServiceProcessInfo,
	getServices,
	getServiceScripts,
	pauseDevServer,
	pauseService,
	prepareService,
	prepareStaleServices,
	restartDevServer,
	resumeDevServer,
	resumeService,
	runServiceScript,
	startService,
	stopService,
} from '../../server/controllers/servers';
import { useRpcQuery } from '../../hooks/useQuery';
import {
	StreamingRpcAction,
	useStreamingRpcQuery,
} from '../../hooks/useStreamingQuery';
import { HealthStatus, isActiveStatus } from '../../server/utils/shared-types';
import { ServiceStatusBadge } from '../../components/ServiceStatusBadge';
import { ZombieServiceControls } from '../../components/ZombieServiceControls';
import { Button } from '../../components/Button';
import {
	Dropdown,
	DropdownButton,
	DropdownContainer,
} from '../../components/Dropdown';
import { getConfig } from '../../server/controllers/config';
import { useRpcMutation } from '../../hooks/useMutation';
import { Modal, ModalBody, ModalTitle } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Monaco } from '../../components/Monaco';
import { Tab, Tabs, TabView } from '../../components/Tabs';
import { AlertCard } from '../../components/AlertCard';
import { Code } from '../../components/Code';
import { debugHooksChanged } from '../../hooks/debug-hooks';
import { Spinner } from '../../components/Spinner';
import { useLogWindow } from '../../hooks/useLogWindow';
import { Toggle } from '../../components/Toggle';
import { JsonLogViewer } from '../../components/JsonLogViewer';
import {
	DefaultServiceStatus,
	useBulkServiceHealth,
	withBulkServiceHealthProvider,
} from '../../hooks/useBulkServiceHealth';
import { useLocalState } from '../../hooks/useLocalState';
import {
	CommandPaletteCommand,
	useCommandPalette,
} from '../../components/CommandPalette';

import type { ServiceConfig } from '../../server/services/service-list';
import type { RpcOutputType } from '../../server/utils/http';

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
}> = ({ serviceName }) => {
	const selectedServerName = useServerName();
	const serviceStatuses = useBulkServiceHealth();

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
						status={
							serviceStatuses[serviceName]?.healthStatus ??
							DefaultServiceStatus.healthStatus
						}
					/>
				</a>
			</Link>
		</li>
	);
};

// This is a bug in the version of eslint-plugin-react that is used by
// eslint-config-next@12 - we can remove this disable when we upgrade to Next 13.
// eslint-disable-next-line react/display-name
const PrepareAllButton: React.FC<{ loading: boolean }> = memo(
	forwardRef(function PrepareAllButton({ loading }, ref) {
		const { mutate: runPrepare, isRunning } = useLogWindow(
			'prepare-all',
			prepareStaleServices,
		);
		return (
			<Button
				ref={ref}
				variant={'info'}
				className={'w-full'}
				size={'sm'}
				icon={<ToolsIcon />}
				loading={isRunning || loading}
				onClick={() =>
					runPrepare({
						title: `Preparing all stale packages`,
						successToast: `Successfully prepared!`,
						errorToast: `Failed to prepare`,
						loadingToast: 'Preparing all stale packages',
						data: {},
					})
				}
			>
				Prepare
			</Button>
		);
	}),
);

function useServiceTags(services?: ServiceConfig[]) {
	return useMemo(
		() => [
			'all',
			'running',
			...[...new Set(services?.flatMap((service) => service.rawTags) ?? [])]
				.filter((tag) => !['all', 'running'].includes(tag))
				.sort(),
		],
		[services],
	);
}

const ServiceList: React.FC = memo(function ServiceList() {
	const serviceStatuses = useBulkServiceHealth();
	const { data: services } = useRpcQuery(
		getServices,
		{},
		{
			onError(error) {
				toast.error(String(error), { id: 'get-servers' });
			},
		},
	);
	const serviceTags = useServiceTags(services);

	const [showAllServices, setShowAllServices] = useState(false);
	const [visibleTag = 'running', setVisibleTag] = useLocalState(
		'selected-tag-view',
		String,
	);
	const selectedServerName = useServerName();
	const visibleServices = useMemo(
		() =>
			services
				?.flatMap((service) =>
					(serviceStatuses[service.name] ?? DefaultServiceStatus).tags.includes(
						visibleTag,
					) ||
					service.name === selectedServerName ||
					serviceStatuses[service.name]?.healthStatus === 'stale'
						? [service]
						: [],
				)
				?.sort(),
		[selectedServerName, serviceStatuses, services, visibleTag],
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
	const areAllVisibleServicesPaused = useMemo(
		() =>
			visibleServices?.reduce(
				(isHealthy, service) =>
					isHealthy &&
					serviceStatuses[service.name]?.healthStatus === HealthStatus.paused,
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
		services,
		showAllServices,
		setShowAllServices,
	});

	return (
		<div className={'flex flex-col h-full'}>
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
										serviceTag: visibleTag,
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
										serviceTag: visibleTag,
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
							<PrepareAllButton loading={isPerformingBulkAction} />
						</Tooltip>

						<Tooltip
							content={
								areAllVisibleServicesPaused
									? `Resume ${visibleTag.toLowerCase()} services`
									: `Pause ${visibleTag.toLowerCase()} services`
							}
						>
							<Button
								variant={areAllVisibleServicesPaused ? 'primary' : 'warning'}
								className={'w-full'}
								size={'sm'}
								loading={isPerformingBulkAction}
								icon={
									areAllVisibleServicesPaused ? (
										<PlayIcon />
									) : (
										<NoEntryFillIcon />
									)
								}
								onClick={() =>
									performBulkAction({
										action: areAllVisibleServicesPaused ? 'resume' : 'pause',
										serviceTag: visibleTag,
										targetEnvironment: undefined,
										environment: undefined,
									})
								}
							>
								{areAllVisibleServicesPaused ? 'Resume' : 'Pause'}
							</Button>
						</Tooltip>
					</div>
				</div>
			)}

			<ul className={'flex flex-col flex-auto overflow-auto'}>
				{visibleServices?.map((service) => (
					<ServiceListEntry key={service.name} serviceName={service.name} />
				))}
			</ul>
		</div>
	);
});

const ServiceEditButton: React.FC<{
	serviceName: string;
	devServerName: string;
	onRestart(): void;
}> = memo(function ServiceEditButton({
	serviceName,
	devServerName,
	onRestart,
}) {
	const { mutate: restart, isLoading: isStarting } = useRpcMutation(
		restartDevServer,
		{
			onSuccess: () => {
				onRestart();
			},
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
				variant={'info'}
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
	const { mutate, isRunning } = useLogWindow(
		`prepare-${serviceName}`,
		prepareService,
	);

	return (
		<Button
			variant={'info'}
			icon={<ToolsIcon />}
			loading={isRunning}
			onClick={() =>
				mutate({
					title: `Preparing ${serviceName}`,
					successToast: `Successfully prepared ${serviceName}!`,
					errorToast: `Failed to prepare: ${serviceName}`,
					loadingToast: `Preparing ${serviceName}`,
					data: { name: serviceName },
				})
			}
		>
			Prepare
		</Button>
	);
};

const ServiceRunScriptButton: React.FC<{ serviceName: string }> = ({
	serviceName,
}) => {
	const {
		data: serviceScripts,
		isLoading,
		error: errFetchingScripts,
	} = useRpcQuery(
		getServiceScripts,
		{ serviceName },
		{
			onError(err) {
				toast.error(`Failed to fetch scripts: ${err}`, { id: 'fetch-scripts' });
			},
		},
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const { mutate: runScript, isRunning } = useLogWindow(
		`script-${serviceName}`,
		runServiceScript,
	);

	return (
		<DropdownContainer>
			<Button
				variant={'secondary'}
				disabled={!!errFetchingScripts}
				loading={isRunning || isLoading}
				icon={<TerminalIcon />}
				onClick={() => setMenuOpen(true)}
			>
				Run script
			</Button>
			<Dropdown show={menuOpen} onClose={() => setMenuOpen(false)}>
				{serviceScripts?.map((scriptName) => (
					<DropdownButton
						key={scriptName}
						onClick={() => {
							runScript({
								title: `Running`,
								successToast: `Successfully ran script!`,
								errorToast: `Script failed`,
								loadingToast: `Running ...`,
								data: { serviceName, scriptName },
							});
							setMenuOpen(false);
						}}
					>
						{scriptName}
					</DropdownButton>
				))}
			</Dropdown>
		</DropdownContainer>
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

const ServicePauseButton: React.FC<{ serviceName: string }> = memo(
	function ServicePauseButton({ serviceName }) {
		const { mutate: pause, isLoading: isPausing } = useRpcMutation(
			pauseService,
			{
				onError: (error) => {
					toast.error(String(error));
				},
			},
		);
		const { mutate: resume, isLoading: isResuming } = useRpcMutation(
			resumeService,
			{
				onError: (error) => {
					toast.error(String(error));
				},
			},
		);
		const serviceStatuses = useBulkServiceHealth();
		const isServicePaused =
			serviceStatuses[serviceName]?.healthStatus === HealthStatus.paused;

		return (
			<Button
				variant={isServicePaused ? 'primary' : 'warning'}
				loading={isPausing || isResuming}
				icon={isServicePaused ? <PlayIcon /> : <NoEntryIcon />}
				onClick={() =>
					isServicePaused
						? resume({ name: serviceName })
						: pause({ name: serviceName })
				}
			>
				{isServicePaused ? 'Resume' : 'Pause'} servers
			</Button>
		);
	},
);

const DevServerPauseButton: React.FC<{
	serviceName: string;
	devServer: string;
}> = memo(function DevServerPauseButton({ serviceName, devServer }) {
	const { mutate: pause, isLoading: isPausing } = useRpcMutation(
		pauseDevServer,
		{
			onError: (error) => {
				toast.error(String(error));
			},
		},
	);
	const { mutate: resume, isLoading: isResuming } = useRpcMutation(
		resumeDevServer,
		{
			onError: (error) => {
				toast.error(String(error));
			},
		},
	);
	const serviceStatuses = useBulkServiceHealth();
	const isServicePaused =
		serviceStatuses[serviceName]?.healthStatus === HealthStatus.paused;

	return (
		<Button
			variant={isServicePaused ? 'primary' : 'warning'}
			loading={isPausing || isResuming}
			icon={isServicePaused ? <PlayIcon /> : <NoEntryIcon />}
			onClick={() =>
				isServicePaused
					? resume({ serviceName, devServer })
					: pause({ serviceName, devServer })
			}
		>
			{isServicePaused ? 'Resume' : 'Pause'} server
		</Button>
	);
});

const safeParse = (str: string) => {
	try {
		return JSON.parse(str);
	} catch {
		return null;
	}
};

const ServiceLogs: React.FC<{
	serviceName: string;
	devServerName: string;
}> = ({ serviceName, devServerName }) => {
	const [refKey, setRefKey] = useState('');
	const { data, dispatch } = useStreamingRpcQuery(
		getServiceLogs,
		useMemo(
			() => ({
				refKey,
				name: serviceName,
				devServer: devServerName,
			}),
			[devServerName, refKey, serviceName],
		),
		useCallback(
			(
				state: { raw: string; json: unknown[] },
				action: StreamingRpcAction<
					RpcOutputType<typeof getServiceLogs>,
					{ type: 'reset' }
				>,
			) => {
				switch (action.type) {
					case 'open':
					case 'reset':
						return { raw: '', json: [] };
					case 'data':
						if (action.data[0] === '{') {
							return {
								raw: state.raw + action.data + '\n',
								json: [...state.json, safeParse(action.data)].filter(Boolean),
							};
						}
						return {
							raw: state.raw + action.data + '\n',
							json: state.json,
						};
					case 'error':
						return {
							raw: `${state.raw}\n\nLog stream errored out: ${action.error}`,
							json: [
								...state.json,
								{
									level: 'error',
									message: `Log stream errored out: ${action.error}`,
								},
							],
						};
					case 'end':
						return {
							raw: `${state.raw}\n\nLogs disconnected.`,
							json: [...state.json],
						};
				}
			},
			[],
		),
		{ raw: '', json: [] },
	);
	const [jsonViewer, setJsonViewer] = useLocalState(
		`${serviceName}-${devServerName}:use-json-viewer`,
		Boolean,
	);

	return (
		<>
			<div className={'space-x-2'}>
				<ServiceEditButton
					serviceName={serviceName}
					devServerName={devServerName}
					onRestart={() => setRefKey(uuid())}
				/>
				<DevServerPauseButton
					serviceName={serviceName}
					devServer={devServerName}
				/>
				<Button
					variant={'secondary'}
					icon={<TrashIcon />}
					onClick={() => dispatch({ type: 'reset' })}
				>
					Clear logs
				</Button>
			</div>

			<div className={'flex mb-4'}>
				<div className={'flex items-center'}>
					<Toggle
						id={'toggle-json'}
						value={!!jsonViewer}
						onChange={setJsonViewer}
					/>
					<label htmlFor={'toggle-json'} className={'ml-2 text-white'}>
						JSON Logs
					</label>
				</div>
			</div>
			{jsonViewer ? (
				<JsonLogViewer
					viewerId={`${serviceName}-${devServerName}`}
					logs={data.json}
				/>
			) : (
				<Monaco
					language={'log'}
					value={data.raw}
					options={{ readOnly: true }}
				/>
			)}
		</>
	);
};

const ServiceControlPanel = () => {
	const selectedServerName = useServerName()!;
	const serviceStatuses = useBulkServiceHealth();
	const selectedServerStatus =
		serviceStatuses[selectedServerName] ?? DefaultServiceStatus;

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
					<div className={'flex items-center space-x-2'}>
						<ServiceStartButton serviceName={selectedServerName} />
						<ServicePrepareButton serviceName={selectedServerName} />
						<ServiceRunScriptButton serviceName={selectedServerName} />
					</div>
				)}

				{isActiveStatus(selectedServerStatus.healthStatus) && (
					<div>
						{serviceConfig &&
							serviceConfig.ports.flatMap((port) =>
								port.type === 'http' ? (
									<div key={port.port ?? port.url} className={'mb-5'}>
										<a
											href={
												port.url ? port.url : `http://localhost:${port.port}/`
											}
											target={'_blank'}
											className={
												'text-blue-500 hover:text-blue-700 hover:border-b border-blue-700 pb-1'
											}
											rel="noreferrer"
										>
											<LinkExternalIcon />
											<span className={'ml-2'}>
												Open{' '}
												{port.url ? port.url : `http://localhost:${port.port}/`}
											</span>
										</a>
									</div>
								) : null,
							)}

						<div className={'space-x-2'}>
							<ServiceStopButton serviceName={selectedServerName} />
							<ServicePauseButton serviceName={selectedServerName} />
							<ServiceRunScriptButton serviceName={selectedServerName} />
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

function useDevServerCommands() {
	const { mutateAsync: start } = useRpcMutation(startService, {
		onError(error: any, { name }) {
			toast.error(`Failed to start ${name}: ${error.message ?? error}`);
		},
	});
	const { mutateAsync: stop } = useRpcMutation(stopService, {
		onError(error: any, { name }) {
			toast.error(`Failed to stop ${name}: ${error.message ?? error}`);
		},
	});
	const { mutate: prepare } = useLogWindow('prepare-no-id-yet', prepareService);
	const { mutate: runScript } = useLogWindow(
		'run-script-no-id-yet',
		runServiceScript,
	);
	const { mutate: prepareAll } = useLogWindow(
		'prepare-all',
		prepareStaleServices,
	);
	const { mutateAsync: performBulkAction } = useRpcMutation(bulkServiceAction, {
		onError(error: any, data) {
			toast.error(
				`Failed to ${data.action} services: ${error.message ?? error}`,
			);
		},
	});

	const { data: services } = useRpcQuery(getServices, {});
	const { data: config } = useRpcQuery(getConfig, {});
	const environments = useMemo(
		() => (config ? Object.keys(config.environments) : []),
		[config],
	);
	const serviceTags = useServiceTags(services);
	const serviceStatuses = useBulkServiceHealth();
	const { registerCommands } = useCommandPalette();
	const router = useRouter();

	debugHooksChanged('devCommands', {
		prepare,
		prepareAll,
	});

	useEffect(() => {
		if (!services) {
			return;
		}

		return registerCommands([
			{
				name: 'Prepare all services',
				action: () =>
					prepareAll({
						title: `Preparing all stale packages`,
						successToast: `Successfully prepared!`,
						errorToast: `Failed to prepare`,
						loadingToast: 'Preparing all stale packages',
						data: {},
					}),
			},
			...environments.flatMap((targetEnvironment) =>
				serviceTags.map((serviceTag) => ({
					name: `Start ${serviceTag} services in ${targetEnvironment}`,
					action: () =>
						performBulkAction({
							action: 'start',
							serviceTag,
							targetEnvironment,
							environment: {},
						}),
				})),
			),
			...(['stop', 'pause', 'resume'] as const).flatMap((action) =>
				serviceTags.map((serviceTag) => ({
					name: `${startCase(action)} ${serviceTag} services`,
					action: () =>
						performBulkAction({
							action,
							serviceTag,
						}),
				})),
			),
			...services.flatMap((service) => {
				const healthStatus =
					serviceStatuses[service.name]?.healthStatus ??
					DefaultServiceStatus.healthStatus;
				const commands: CommandPaletteCommand[] = [];

				if (isActiveStatus(healthStatus)) {
					commands.push(
						{
							name: `Stop ${service.name}`,
							action: () =>
								stop({
									name: service.name,
								}),
						},
						{
							name: `Restart ${service.name}`,
							action: () =>
								stop({
									name: service.name,
								}).then(() =>
									start({
										name: service.name,
										targetEnvironment: 'local',
										environment: {},
									}),
								),
						},
						...service.ports.flatMap((port) => {
							if (port.type !== 'http') {
								return [];
							}

							const link = `http://localhost:${port.port}`;
							return [
								{
									name: `Open ${service.name} (${link})`,
									action: () => window.open(link, '_blank'),
								},
							];
						}),
					);

					Object.keys(service.devServers).forEach((devServer) => {
						commands.push({
							name: `Show ${service.name} ${devServer} logs`,
							action: () =>
								router.push(`/servers/${service.name}/logs/${devServer}`),
						});
					});
				} else {
					commands.push(
						...environments.map((envName) => ({
							name: `Start ${service.name} in ${envName}`,
							action: () =>
								start({
									name: service.name,
									targetEnvironment: envName,
									environment: {},
								}),
						})),
						{
							name: `Prepare ${service.name}`,
							action: () =>
								prepare({
									id: `prepare-${service.name}`,
									title: `Preparing ${service.name}`,
									successToast: `Successfully prepared ${service.name}!`,
									errorToast: `Failed to prepare: ${service.name}`,
									loadingToast: `Preparing ${service.name}`,
									data: {
										name: service.name,
									},
								}),
						},
					);
				}

				Object.keys(service.scripts).forEach((scriptName) => {
					commands.push({
						name: `Run ${scriptName} in ${service.name}`,
						action: () =>
							runScript({
								id: `script-${service.name}`,
								title: `Running ${scriptName}`,
								successToast: `Successfully ran ${scriptName}!`,
								errorToast: `Failed to run: ${scriptName}`,
								loadingToast: `Running ${scriptName}`,
								data: {
									serviceName: service.name,
									scriptName,
								},
							}),
					});
				});

				return commands;
			}),
		]);
	}, [
		config,
		environments,
		performBulkAction,
		prepare,
		prepareAll,
		registerCommands,
		router,
		runScript,
		serviceStatuses,
		serviceTags,
		services,
		start,
		stop,
	]);
}

export default withSidebar(
	withBulkServiceHealthProvider(function Servers() {
		const selectedServerName = useServerName();
		const { data: services, error } = useRpcQuery(getServices, {});
		useDevServerCommands();

		return (
			<>
				<Head>
					<title>Servers | Sidekick</title>
				</Head>

				<div className={'h-full flex-auto flex flex-col'}>
					<div className={'flex justify-end mb-5'}>
						<p className={'text-xs text-white'}>
							Use{' '}
							<span className={'p-1 rounded bg-slate-300 text-black'}>Cmd</span>{' '}
							+ <span className={'p-1 rounded bg-slate-300 text-black'}>P</span>{' '}
							to access the command palette.
						</p>
					</div>
					<div className={'bg-slate-900 rounded flex flex-auto min-h-0'}>
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
									<ServiceList />
								</div>

								{selectedServerName && (
									<div className={'flex flex-col w-3/4 p-5'}>
										<ServiceControlPanel />
									</div>
								)}
							</>
						)}
					</div>
				</div>
			</>
		);
	}),
);
