import constate from 'constate';
import * as React from 'react';
import { useMutation, useQueryClient } from 'react-query';
import Head from 'next/head';
import toast from 'react-hot-toast';

import { fetchStream } from '../utils/fetch-stream';
import { HealthStatus, ServiceConfig } from '../utils/shared-types';
import { withSidebar } from '../components/Sidebar';

type ElementType<T> = T extends (infer G)[] ? G : never;

const [ServerManagerStateProvider, useServerManagerState] = constate(function useServerManagerState() {
    const [services, setServices] = React.useState<(ServiceConfig & { health: HealthStatus | 'unknown' })[]>([]);
    const [selectedService, setSelectedService] = React.useState<ElementType<typeof services> | null>(null);
    const [showNonEssentialServices, setShowNonEssentialServices] = React.useState<boolean>(false);
    const numHiddenServices = React.useMemo(
        () => services.filter(service => service.health === HealthStatus.none && !service.core).length,
        [services]
    );

    React.useEffect(() => {
        if (services) {
            setSelectedService(selectedService => {
                if (selectedService) {
                    return services.find(s => s.name === selectedService.name) ?? null;
                }
                return services[0];
            });
        }
    }, [services]);

    return {
        services,
        numHiddenServices,
        setServices,
        selectedService,
        setSelectedService,
        showNonEssentialServices,
        setShowNonEssentialServices
    };
});

const isNever = (x: never) => x;

const ServiceStatusBadge: React.FC<{ status: HealthStatus }> = ({ status }) => {
    switch (status) {
        case HealthStatus.healthy:
            return <div style={{ width: 10, height: 10, borderRadius: 10, background: green[500] }} />;
        case HealthStatus.zombie:
            return (
                <Tooltip title={'The dev server is running, but is not owned by hygenist.'}>
                    <WarningIcon style={{ color: orange[500] }} />
                </Tooltip>
            );
        case HealthStatus.failing:
            return (
                <Tooltip title={'The dev server is failing to run.'}>
                    <ErrorIcon style={{ color: red[500] }} />
                </Tooltip>
            );
        case HealthStatus.none:
            return null;
        case HealthStatus.partial:
            return (
                <Tooltip title={'Some parts of this service are functional.'}>
                    <div style={{ width: 10, height: 10, borderRadius: 10, background: orange[500] }} />
                </Tooltip>
            );
        case HealthStatus.stale:
            return (
                <Tooltip
                    title={'No dev server is running, but the compiled version of this package is now out-of-date.'}
                >
                    <span style={{ color: orange[500] }}>{status}</span>
                </Tooltip>
            );
        case HealthStatus.paused:
            return (
                <Tooltip title={'You have paused the dev servers.'}>
                    <span style={{ color: orange[500] }}>{status}</span>
                </Tooltip>
            );

        default:
            isNever(status);
            return <span>{status}</span>;
    }
};

function ServerListItem({ service }: { service: ServiceConfig }) {
    const { setServices, selectedService, setSelectedService, showNonEssentialServices } = useServerManagerState();
    const { data: health, refetch: refetchHealth } = useRequest<HealthStatus>(
        `/api/servers/${service.name}/health`,
        {},
        {
            // prefer this to using the builtin refetch interval, because the builtin does
            // not wait for the request to complete
            onSuccess: () => setTimeout(() => refetchHealth(), 1e3)
        }
    );
    React.useEffect(() => {
        setServices(services =>
            services.map(existing => {
                if (existing.name === service.name) {
                    return {
                        ...existing,
                        health: health ?? 'unknown'
                    };
                }
                return existing;
            })
        );
    }, [health, service.name, setServices]);

    if (!health) {
        return (
            <ListItemButton>
                <CircularProgress />
            </ListItemButton>
        );
    }
    if (health === 'none' && !service.core && !showNonEssentialServices) {
        return null;
    }
    return (
        <ListItemButton
            onClick={() => setSelectedService({ ...service, health })}
            selected={selectedService?.name === service.name}
        >
            <ListItemText
                primary={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>{service.name}</span>
                        <ServiceStatusBadge status={health} />
                    </div>
                }
            />
        </ListItemButton>
    );
}

const StartServiceConfig: React.FC = () => {
    const { selectedService } = useServerManagerState();
    const {
        data: databaseList,
        error: errLoadingDatabaseList,
        isLoading: loadingDatabaseList
    } = useRequest<string[]>('/api/databases', {});
    const [database, setDatabase] = React.useState<string>('endToEndLocal');
    const queryClient = useQueryClient();
    const {
        mutate: startApp,
        isLoading: isStarting,
        error: errStarting
    } = useMutation(
        async ({ app, dbName }: { app: string; dbName: string }) => axios.post(`/api/servers/${app}/start`, { dbName }),
        {
            onSuccess: (_, { app }) => queryClient.invalidateQueries(`/api/servers/${app}/health`)
        }
    );

    const error = errLoadingDatabaseList || errStarting;

    if (!selectedService) {
        return null;
    }
    return (
        <Card style={{ marginBottom: 24 }}>
            <CardContent>
                <Typography variant={'body2'} style={{ padding: 0, marginBottom: 24 }}>
                    Start dev server
                </Typography>

                {error && (
                    <Alert severity={'error'} style={{ marginBottom: 24 }}>
                        {String(error)}
                    </Alert>
                )}

                {selectedService.type === 'backend' && (
                    <FormControl variant={'standard'} fullWidth>
                        <InputLabel style={{ marginRight: 16 }}>Database:</InputLabel>
                        <Select
                            key={databaseList?.[0] ?? ''}
                            disabled={!!(loadingDatabaseList || errLoadingDatabaseList)}
                            value={database}
                            onChange={evt => setDatabase(evt.target.value)}
                        >
                            {databaseList?.map(database => (
                                <MenuItem key={database} value={database}>
                                    {database}
                                </MenuItem>
                            )) ?? <MenuItem value={'endToEndLocal'}>{'endToEndLocal'}</MenuItem>}
                        </Select>
                    </FormControl>
                )}

                <LoadingButton
                    loading={isStarting}
                    disabled={!database && selectedService.type === 'backend'}
                    loadingPosition={'start'}
                    variant={'contained'}
                    color={'success'}
                    size={'small'}
                    startIcon={<PlayCircleFilledWhiteIcon />}
                    style={{ marginTop: 24 }}
                    onClick={() => startApp({ app: selectedService.name, dbName: database ?? '' })}
                >
                    Start
                </LoadingButton>
            </CardContent>
        </Card>
    );
};

const ServiceLogs: React.FC<{ process: string }> = ({ process }) => {
    const { selectedService } = useServerManagerState();
    const [logs, setLogs] = React.useState('Waiting for logger to connect');
    const abortControllerRef = React.useRef<AbortController | null>(null);
    const { mutate: fetchLogs, error: errLoadingLogs } = useMutation(
        async ({ app, process }: { app: string; process: string }) => {
            let output = '';
            for await (const chunk of fetchStream(`/api/servers/${app}/logs?process=${process}`, {
                signal: abortControllerRef.current?.signal
            })) {
                output += chunk;
                setLogs(output);
            }
        },
        {
            retry: 100
        }
    );
    React.useEffect(() => {
        if (selectedService) {
            setLogs('Waiting for logger to connect');
            abortControllerRef.current?.abort();
            abortControllerRef.current = new AbortController();
            fetchLogs({ process, app: selectedService.name });
            return () => abortControllerRef.current?.abort();
        }
    }, [fetchLogs, process, selectedService]);

    if (!selectedService) {
        return null;
    }
    return (
        <Editor
            theme={'vs-dark'}
            height={'100%'}
            language={'log'}
            options={{ readOnly: true }}
            value={errLoadingLogs ? `${logs}\n\n${String(errLoadingLogs)}` : logs}
        />
    );
};

const ServiceControlPanel: React.FC = () => {
    const { selectedService } = useServerManagerState();
    const queryClient = useQueryClient();
    const { mutate: prepareService, isLoading: isPreparingService } = useMutation(
        async ({ app }: { app: string }) => axios.post(`/api/servers/${app}/prepare`),
        {
            onSuccess: (_, { app }) => queryClient.invalidateQueries(`/api/servers/${app}/health`)
        }
    );
    const { mutate: restartService, isLoading: isRestartingService } = useMutation(
        async ({ app }: { app: string }) => axios.post(`/api/servers/${app}/restart`),
        {
            onSuccess: (_, { app }) => queryClient.invalidateQueries(`/api/servers/${app}/health`)
        }
    );
    const { mutate: killService, isLoading: isKillingService } = useMutation(
        async ({ app }: { app: string }) => axios.post(`/api/servers/${app}/stop`),
        {
            onSuccess: (_, { app }) => queryClient.invalidateQueries(`/api/servers/${app}/health`)
        }
    );
    const { mutate: pauseService, isLoading: isPausingService } = useMutation(
        async ({ app }: { app: string }) => axios.post(`/api/servers/${app}/pause`),
        {
            onSuccess: (_, { app }) => queryClient.invalidateQueries(`/api/servers/${app}/health`)
        }
    );
    const { mutate: resumeService, isLoading: isResumingService } = useMutation(
        async ({ app }: { app: string }) => axios.post(`/api/servers/${app}/resume`),
        {
            onSuccess: (_, { app }) => queryClient.invalidateQueries(`/api/servers/${app}/health`)
        }
    );

    const isServiceRunning =
        selectedService?.health !== 'none' &&
        selectedService?.health !== 'zombie' &&
        selectedService?.health !== 'stale';

    if (!selectedService) {
        return null;
    }
    return (
        <>
            {selectedService.type !== 'package' && isServiceRunning && (
                <Grid container item spacing={1} style={{ marginBottom: 24 }}>
                    <a
                        href={`http://localhost:${selectedService.port}`}
                        target={'_blank'}
                        style={{
                            marginLeft: 8,
                            display: 'flex',
                            alignItems: 'center'
                        }}
                        rel={'noreferrer'}
                    >
                        <OpenInNewIcon />
                        <span style={{ marginLeft: 8 }}>Open http://localhost:{selectedService.port}/</span>
                    </a>
                </Grid>
            )}

            <Grid container item spacing={1} style={{ marginBottom: 24 }}>
                {selectedService.type === 'package' && !isServiceRunning && (
                    <Grid item>
                        <LoadingButton
                            loading={isPreparingService}
                            disabled={isKillingService || isRestartingService || isPausingService || isResumingService}
                            loadingPosition={'start'}
                            variant={'contained'}
                            color={'info'}
                            size={'small'}
                            startIcon={<BuildIcon />}
                            onClick={() => prepareService({ app: selectedService.name })}
                        >
                            Run prepare
                        </LoadingButton>
                    </Grid>
                )}

                {isServiceRunning && (
                    <Grid item>
                        <LoadingButton
                            loading={isRestartingService}
                            disabled={isKillingService || isPreparingService || isPausingService || isResumingService}
                            loadingPosition={'start'}
                            variant={'contained'}
                            color={'warning'}
                            size={'small'}
                            startIcon={<CachedIcon />}
                            onClick={() => restartService({ app: selectedService.name })}
                        >
                            Restart service
                        </LoadingButton>
                    </Grid>
                )}
                {isServiceRunning && (
                    <>
                        <Grid item>
                            <LoadingButton
                                loading={isKillingService}
                                disabled={
                                    isRestartingService || isPreparingService || isPausingService || isResumingService
                                }
                                loadingPosition={'start'}
                                variant={'contained'}
                                color={'error'}
                                size={'small'}
                                startIcon={<StopCircleIcon />}
                                onClick={() => killService({ app: selectedService.name })}
                            >
                                Stop service
                            </LoadingButton>
                        </Grid>
                        <Grid item>
                            <LoadingButton
                                loading={isPausingService || isResumingService}
                                disabled={isRestartingService || isPreparingService}
                                loadingPosition={'start'}
                                variant={'contained'}
                                color={selectedService.health === HealthStatus.paused ? 'success' : 'info'}
                                size={'small'}
                                startIcon={
                                    selectedService.health === HealthStatus.paused ? (
                                        <PlayCircleFilledWhiteIcon />
                                    ) : (
                                        <PauseCircleIcon />
                                    )
                                }
                                onClick={() =>
                                    selectedService.health === HealthStatus.paused
                                        ? resumeService({ app: selectedService.name })
                                        : pauseService({ app: selectedService.name })
                                }
                            >
                                {selectedService.health === HealthStatus.paused ? 'Resume' : 'Pause'} service
                            </LoadingButton>
                        </Grid>
                    </>
                )}
            </Grid>
        </>
    );
};

const ServiceStaleFiles: React.FC = () => {
    const { selectedService } = useServerManagerState();
    const { data: staleFilesByCommit } = useRequest<Record<string, string[]>>(
        `/api/servers/${selectedService?.name}/stale-files`,
        {}
    );
    const onCommitOpen = React.useCallback((commit: string) => {
        const matches = commit.match(/\(#([0-9]+)\)$/);
        if (matches) {
            window.open(`https://github.com/orthly/orthlyweb/pull/${matches[1]}`);
            return;
        }

        window.open(`https://github.com/orthly/orthlyweb/tree/${commit.split(' ')[0]}`);
    }, []);

    if (!selectedService) {
        return null;
    }
    return (
        <>
            <Typography variant={'body1'} style={{ fontWeight: 'bold' }}>
                The compiled version of this package is out-of-date.
            </Typography>

            {staleFilesByCommit && (
                <>
                    {Object.entries(staleFilesByCommit)
                        .slice(0, 2)
                        .map(([commit, files]) => (
                            <>
                                <Chip
                                    label={commit}
                                    style={{ marginTop: 24, cursor: 'pointer' }}
                                    onClick={() => onCommitOpen(commit)}
                                />
                                <ul style={{ marginTop: 5 }}>
                                    {files.slice(0, 3).map(file => (
                                        <li>{file}</li>
                                    ))}
                                    {files.length > 3 && <li>{files.length - 3} additional files are also stale.</li>}
                                </ul>
                            </>
                        ))}
                    {Object.keys(staleFilesByCommit).length > 2 && (
                        <Typography variant={'body2'}>
                            {Object.values(staleFilesByCommit).slice(2).flat().length} more stale files hidden.
                        </Typography>
                    )}
                </>
            )}
        </>
    );
};

const StartAllButton: React.FC = () => {
    const [startTargetType, setStartTargetType] = React.useState<string | null>(null);

    const [startAllButtonElm, setStartAllButtonElm] = React.useState<HTMLButtonElement | null>(null);
    const [stopAllButtonElm, setStopAllButtonElm] = React.useState<HTMLButtonElement | null>(null);

    const {
        data: databaseList,
        error: errLoadingDatabaseList,
        isLoading: loadingDatabaseList
    } = useRequest<string[]>('/api/databases', {});
    const [database, setDatabase] = React.useState('endToEndLocal');
    const { mutate: startAll, isLoading: isStarting } = useMutation(
        async ({ dbName, targetType }: { dbName: string; targetType: string | undefined }) => {
            setStartAllButtonElm(null);
            return axios.post('/api/servers/start', { targetType, dbName });
        },
        {
            onError: err => {
                toast.error(String(err).split('\n')[0]);
            }
        }
    );
    const { mutate: stopAll, isLoading: isStopping } = useMutation(
        async (body: { targetType?: string }) => {
            setStopAllButtonElm(null);
            return axios.post('/api/servers/stop', body);
        },
        {
            onError: err => {
                toast.error(String(err).split('\n')[0]);
            }
        }
    );

    return (
        <>
            <Grid item>
                <Menu
                    open={!!startAllButtonElm}
                    anchorEl={startAllButtonElm}
                    onClose={() => setStartAllButtonElm(null)}
                >
                    <MenuItem onClick={() => setStartTargetType('all')}>Start all default servers</MenuItem>
                    <MenuItem onClick={() => setStartTargetType('backend')}>Start all backend servers</MenuItem>
                    {['frontend', 'package'].map(targetType => (
                        <MenuItem key={targetType} onClick={() => startAll({ targetType, dbName: 'endToEndLocal' })}>
                            Start all {targetType} servers
                        </MenuItem>
                    ))}
                </Menu>
                <LoadingButton
                    loading={isStopping}
                    loadingPosition={'start'}
                    disabled={isStarting}
                    variant={'contained'}
                    color={'success'}
                    size={'small'}
                    startIcon={<PlayCircleFilledWhiteIcon />}
                    onClick={evt => setStartAllButtonElm(evt.currentTarget)}
                >
                    Start servers
                </LoadingButton>
            </Grid>

            <Grid item>
                <Menu open={!!stopAllButtonElm} anchorEl={stopAllButtonElm} onClose={() => setStopAllButtonElm(null)}>
                    <MenuItem onClick={() => stopAll({})}>Stop all default servers</MenuItem>
                    {['backend', 'frontend', 'package'].map(targetType => (
                        <MenuItem key={targetType} onClick={() => stopAll({ targetType })}>
                            Stop all {targetType} servers
                        </MenuItem>
                    ))}
                </Menu>
                <LoadingButton
                    loading={isStopping}
                    loadingPosition={'start'}
                    disabled={isStarting}
                    variant={'contained'}
                    color={'error'}
                    size={'small'}
                    startIcon={<StopCircleIcon />}
                    onClick={evt => setStopAllButtonElm(evt.currentTarget)}
                >
                    Stop servers
                </LoadingButton>
            </Grid>

            {startTargetType && (
                <Dialog
                    open={!!startTargetType}
                    onClose={() => setStartTargetType(null)}
                    fullWidth
                    maxWidth={'sm'}
                    scroll={'paper'}
                >
                    <DialogContent>
                        <Typography variant={'body2'} style={{ marginBottom: 16 }}>
                            Start all {startTargetType} servers with params:
                        </Typography>
                        <FormControl variant={'standard'} fullWidth>
                            <InputLabel style={{ marginRight: 16 }}>Database:</InputLabel>
                            <Select
                                key={databaseList?.[0] ?? ''}
                                disabled={!!(loadingDatabaseList || errLoadingDatabaseList)}
                                value={database}
                                onChange={evt => setDatabase(evt.target.value)}
                            >
                                {databaseList?.map(database => (
                                    <MenuItem key={database} value={database}>
                                        {database}
                                    </MenuItem>
                                )) ?? <MenuItem value={'endToEndLocal'}>{'endToEndLocal'}</MenuItem>}
                            </Select>
                        </FormControl>
                    </DialogContent>
                    <DialogActions>
                        <LoadingButton
                            loading={isStarting}
                            loadingPosition={'start'}
                            variant={'contained'}
                            color={'success'}
                            size={'small'}
                            startIcon={<PlayCircleFilledWhiteIcon />}
                            onClick={() => {
                                startAll({
                                    targetType: startTargetType === 'all' ? undefined : startTargetType,
                                    dbName: database
                                });
                                setStartTargetType(null);
                            }}
                        >
                            Start core servers
                        </LoadingButton>
                    </DialogActions>
                </Dialog>
            )}
        </>
    );
};

const PrepareAllButton: React.FC = () => {
    const { services } = useServerManagerState();
    const [prepareLogs, setPrepareLogs] = React.useState('Waiting for logger to connect');
    const { mutate: prepareAll, isLoading: isPreparing } = useMutation(async () => {
        let output = '';
        try {
            for await (const chunk of fetchStream(`/api/servers/prepare`, { method: 'POST' })) {
                output += chunk;
                setPrepareLogs(output);
            }
            setPrepareLogs(output + `\n\nProcess exited.`);
        } catch (error) {
            setPrepareLogs(output + `\n\nProcess failed.\n\n${error}`);
        }
    });
    const [isOpen, setOpen] = React.useState(false);

    if (services.filter(service => service.health === HealthStatus.stale).length === 0) {
        return null;
    }
    return (
        <>
            <Grid item>
                <LoadingButton
                    loading={isPreparing}
                    loadingPosition={'start'}
                    variant={'contained'}
                    color={'info'}
                    size={'small'}
                    startIcon={<BuildIcon />}
                    onClick={() => {
                        setOpen(true);
                        prepareAll();
                    }}
                >
                    Prepare all stale packages
                </LoadingButton>
            </Grid>

            {isOpen && (
                <Dialog
                    open={isOpen}
                    onClose={() => setOpen(false)}
                    fullWidth
                    maxWidth={'lg'}
                    scroll={'paper'}
                    PaperProps={{
                        style: { height: '80vh' }
                    }}
                >
                    <DialogTitle>
                        <Typography variant={'body2'}>Building stale packages</Typography>
                    </DialogTitle>
                    <DialogContent>
                        <Editor
                            theme={'vs-dark'}
                            height={'100%'}
                            language={'log'}
                            value={prepareLogs}
                            options={{ readOnly: true }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <LoadingButton
                            loading={isPreparing}
                            loadingPosition={'start'}
                            variant={'contained'}
                            color={'info'}
                            size={'small'}
                            onClick={() => setOpen(false)}
                        >
                            Done
                        </LoadingButton>
                    </DialogActions>
                </Dialog>
            )}
        </>
    );
};

const ZombieServiceAlert: React.FC<{ app: string }> = ({ app }) => {
    const { mutate: forceKill, isLoading: isKilling } = useMutation(
        async ({ app }: { app: string }) => axios.post(`/api/servers/${app}/force-kill`),
        {
            onSuccess: ({ app }) => {
                toast.success(`Successfully killed zombie ${app}!`);
            },
            onError: error => {
                toast.error(String(error).split('\n')[0]);
            }
        }
    );

    return (
        <Alert severity={'error'}>
            <span>
                Hygenist does not own the dev server for this service. Please close the existing dev server to use
                Hygenist.
            </span>
            <LoadingButton
                loading={isKilling}
                variant={'contained'}
                color={'error'}
                size={'small'}
                style={{ marginTop: 16 }}
                onClick={() => forceKill({ app })}
            >
                Force kill
            </LoadingButton>
        </Alert>
    );
};

function ServersPage() {
    const { data: serversList, error } = useRequest<ServiceConfig[]>('/api/servers', {});
    const {
        services,
        numHiddenServices,
        setServices,
        showNonEssentialServices,
        setShowNonEssentialServices,
        selectedService,
        setSelectedService
    } = useServerManagerState();

    React.useEffect(() => {
        if (serversList) {
            setServices(
                serversList.map(service => ({
                    ...service,
                    health: 'unknown'
                }))
            );
        }
    }, [serversList, setSelectedService, setServices]);
    React.useEffect(() => {
        if (selectedService) {
            setView('controls');
        }
    }, [selectedService]);

    const [view, setView] = React.useState('controls');

    return (
        <>
            <Head>
                <title>{selectedService?.name ?? 'Dev Servers'} | Hygenist</title>
            </Head>

            <Card className={'grid-item-fill'} style={{ display: 'flex' }}>
                <CardContent className={'grid-item-fill'} style={{ display: 'flex', flexDirection: 'column' }}>
                    {error && (
                        <Alert severity={'error'} style={{ marginBottom: 24 }}>
                            {String(error)}
                        </Alert>
                    )}

                    <Grid container item className={'grid-item-fill'} style={{ height: '100%' }}>
                        <Grid container item xs={3} style={{ height: '100%' }}>
                            <List
                                component={'div'}
                                className={'grid-item-fill'}
                                style={{ overflow: 'auto', height: '100%' }}
                                disablePadding
                            >
                                <ListItem>
                                    <Grid container spacing={1} style={{ flexDirection: 'column' }}>
                                        <PrepareAllButton />
                                        <StartAllButton />
                                    </Grid>
                                </ListItem>

                                <ListItem>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={showNonEssentialServices}
                                                onChange={evt => setShowNonEssentialServices(evt.target.checked)}
                                            />
                                        }
                                        label={'Show all services'}
                                    />
                                </ListItem>
                                {numHiddenServices > 0 && !showNonEssentialServices && (
                                    <ListItemButton disabled={true}>
                                        <ListItemText
                                            primary={`${numHiddenServices} non-essential services are hidden.`}
                                        />
                                    </ListItemButton>
                                )}
                                {services.map(service => (
                                    <ServerListItem key={service.name} service={service} />
                                ))}
                            </List>
                        </Grid>

                        {selectedService && (
                            <Grid item xs={9} style={{ padding: 24 }}>
                                <Typography variant={'h6'} style={{ marginBottom: 24 }}>
                                    Service: {selectedService.name}
                                </Typography>

                                {selectedService.health === 'zombie' ? (
                                    <ZombieServiceAlert app={selectedService.name} />
                                ) : (
                                    <Tabs
                                        value={view}
                                        onChange={(_, view) => setView(view)}
                                        scrollButtons={'auto'}
                                        style={{ marginBottom: 24 }}
                                    >
                                        <Tab label={'Control panel'} value={'controls'} />

                                        {!['none', 'zombie', 'stale'].includes(selectedService.health) &&
                                            Object.keys(selectedService.processes)
                                                .sort()
                                                .map(devServer => <Tab label={devServer} value={devServer} />)}
                                    </Tabs>
                                )}

                                <div role={'tabpanel'} hidden={view !== 'controls'}>
                                    <ServiceControlPanel />
                                    {(selectedService.health === 'none' || selectedService.health === 'stale') && (
                                        <StartServiceConfig />
                                    )}
                                    {selectedService.health === 'stale' && <ServiceStaleFiles />}
                                </div>

                                {Object.keys(selectedService.processes)
                                    .sort()
                                    .map(
                                        devServer =>
                                            view === devServer && (
                                                <div
                                                    key={devServer}
                                                    role={'tabpanel'}
                                                    style={{
                                                        display: view === devServer ? 'flex' : 'none',
                                                        height: '100%',

                                                        // oh monaco, why....
                                                        //    - Karim Alibhai, Nov 29, 2021 Mon 20:19 EST
                                                        maxHeight: '90vh'
                                                    }}
                                                >
                                                    <ServiceLogs process={devServer} />
                                                </div>
                                            )
                                    )}
                            </Grid>
                        )}
                    </Grid>
                </CardContent>
            </Card>
        </>
    );
}

export default withSidebar(function ServersPageContainer() {
    return (
        <ServerManagerStateProvider>
            <ServersPage />
        </ServerManagerStateProvider>
    );
});
