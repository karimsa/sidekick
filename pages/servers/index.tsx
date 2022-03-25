/* eslint-disable react/display-name */

import * as React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { withSidebar } from '../../components/Sidebar';
import { getServerHealth, getServers, startService, stopService } from '../../server/controllers/servers';
import Head from 'next/head';
import { useRpcQuery } from '../../hooks/useQuery';
import { toast } from 'react-hot-toast';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { useStreamingRpcQuery } from '../../hooks/useStreamingQuery';
import { HealthStatus } from '../../utils/shared-types';
import { RpcOutputType } from '../../utils/http';
import { Toggle } from '../../components/Toggle';
import { ServiceStatusBadge } from '../../components/ServiceStatusBadge';
import { debugHooksChanged } from '../../hooks/debug-hooks';
import { ZombieServiceControls } from '../../components/ZombieServiceControls';
import { Button } from '../../components/Button';
import { PlayIcon, StopIcon } from '@primer/octicons-react';
import { Dropdown, DropdownButton, DropdownContainer } from '../../components/Dropdown';
import { getConfig } from '../../server/controllers/config';
import { useRpcMutation } from '../../hooks/useMutation';
import Tooltip from '@tippyjs/react';

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

    // TODO: Auto restart the stream if it ends
    const { data, error } = useStreamingRpcQuery(
        getServerHealth,
        {
            name: serviceName
        },
        useCallback((state, action) => {
            switch (action.type) {
                case 'data':
                    return action.data;
                case 'end':
                    return { healthStatus: HealthStatus.none, version: state.version };
            }
        }, []),
        { healthStatus: HealthStatus.none, version: '(unknown)' }
    );

    const statusUpdateRef = useRef(onStatusUpdate);
    statusUpdateRef.current = onStatusUpdate;

    useEffect(() => {
        statusUpdateRef.current(data);
    }, [data]);

    if (!showAllServices && !error && selectedServerName !== serviceName && healthStatus === HealthStatus.none) {
        return null;
    }
    return (
        <li>
            <Link href={`/servers/${serviceName}`} passHref>
                <a
                    className={classNames('text-white p-4 hover:bg-slate-600 block flex items-center justify-between', {
                        'bg-emerald-700': selectedServerName === serviceName
                    })}
                >
                    <span>{serviceName}</span>
                    <ServiceStatusBadge
                        status={error ? HealthStatus.failing : healthStatus}
                        error={error ? String(error) : undefined}
                    />
                </a>
            </Link>
        </li>
    );
};

const ServiceList: React.FC<{
    serviceStatuses: Record<string, RpcOutputType<typeof getServerHealth>>;
    setServiceStatuses(statuses: Record<string, RpcOutputType<typeof getServerHealth>>): void;
}> = memo(({ serviceStatuses, setServiceStatuses }) => {
    const { data: services } = useRpcQuery(
        getServers,
        {},
        {
            onError(error) {
                toast.error(String(error), { id: 'get-servers' });
            }
        }
    );

    const numHiddenServices = useMemo(
        () =>
            Object.values(serviceStatuses).reduce((numHiddenServices, status) => {
                return numHiddenServices + (status.healthStatus === HealthStatus.none ? 1 : 0);
            }, 0),
        [serviceStatuses]
    );

    const [showAllServices, setShowAllServices] = useState(false);

    debugHooksChanged('ServiceList', {
        serviceStatuses,
        setServiceStatuses,
        services,
        numHiddenServices,
        showAllServices,
        setShowAllServices
    });

    return (
        <ul
            className={'overflow-auto'}
            style={{
                maxHeight: 'calc(100vh - (2*1.25rem))'
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
            {services?.map(serviceName => (
                <ServiceListEntry
                    key={serviceName}
                    serviceName={serviceName}
                    showAllServices={showAllServices}
                    healthStatus={serviceStatuses[serviceName]?.healthStatus ?? HealthStatus.none}
                    onStatusUpdate={status =>
                        setServiceStatuses({
                            ...serviceStatuses,
                            [serviceName]: status
                        })
                    }
                />
            ))}
        </ul>
    );
});

const ServiceStartButton: React.FC<{ serviceName: string }> = memo(({ serviceName }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const { data: config, error } = useRpcQuery(getConfig, {});
    const { mutate: start } = useRpcMutation(startService);
    console.dir(config?.environments);

    return (
        <DropdownContainer>
            <Button variant={'primary'} disabled={!!error} onClick={() => setMenuOpen(!menuOpen)}>
                <PlayIcon />
                <span className={'ml-2'}>Start dev servers</span>
            </Button>

            <Dropdown show={menuOpen && !error}>
                {config &&
                    Object.keys(config.environments).map(env => (
                        <Tooltip key={env} content={String(error)} disabled={!error}>
                            <DropdownButton
                                className={'text-sm'}
                                onClick={() => start({ name: serviceName, targetEnvironment: env, environment: {} })}
                            >
                                Start in {env}
                            </DropdownButton>
                        </Tooltip>
                    ))}
            </Dropdown>
        </DropdownContainer>
    );
});

const ServiceStopButton: React.FC<{ serviceName: string }> = memo(({ serviceName }) => {
    const { mutate: stop, isLoading } = useRpcMutation(stopService, {
        onError: error => {
            toast.error(String(error));
        }
    });

    return (
        <Button variant={'danger'} loading={isLoading} onClick={() => stop({ name: serviceName })}>
            <StopIcon />
            <span className={'ml-2'}>Stop servers</span>
        </Button>
    );
});

const ServiceControlPanel: React.FC<{
    serviceStatuses: Record<string, RpcOutputType<typeof getServerHealth>>;
}> = ({ serviceStatuses }) => {
    const selectedServerName = useServerName();
    const selectedServerStatus = serviceStatuses[selectedServerName] ?? {
        healthStatus: HealthStatus.none,
        version: '(unknown)'
    };

    return (
        <>
            <div className="flex items-center mb-5">
                <h1 className={'text-2xl text-white font-bold'}>{selectedServerName}</h1>
                <span className={'rounded bg-slate-700 text-xs text-white p-1 ml-2'}>
                    v{String(selectedServerStatus.version)}
                </span>
            </div>

            {(selectedServerStatus.healthStatus === HealthStatus.none ||
                selectedServerStatus.healthStatus === HealthStatus.stale) && (
                <ServiceStartButton serviceName={selectedServerName} />
            )}

            {(selectedServerStatus.healthStatus === HealthStatus.failing ||
                selectedServerStatus.healthStatus === HealthStatus.healthy ||
                selectedServerStatus.healthStatus === HealthStatus.paused) && (
                <ServiceStopButton serviceName={selectedServerName} />
            )}

            {selectedServerStatus.healthStatus === HealthStatus.zombie && (
                <ZombieServiceControls serviceName={selectedServerName} />
            )}
        </>
    );
};

export default withSidebar(function Servers() {
    const [serviceStatuses, setServiceStatuses] = useState<Record<string, RpcOutputType<typeof getServerHealth>>>({});
    const selectedServerName = useServerName();

    return (
        <>
            <Head>
                <title>Servers | Sidekick</title>
            </Head>

            <div className={'flex-auto'}>
                <div className={'bg-slate-900 rounded h-full flex'}>
                    <div className={'w-1/4'}>
                        <ServiceList serviceStatuses={serviceStatuses} setServiceStatuses={setServiceStatuses} />
                    </div>

                    {selectedServerName && (
                        <div className={'w-3/4 p-5'}>
                            <ServiceControlPanel serviceStatuses={serviceStatuses} />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
});
