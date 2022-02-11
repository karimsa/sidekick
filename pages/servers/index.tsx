import * as React from 'react';
import { useMemo, useState } from 'react';
import Tooltip from '@tippyjs/react';
import { AlertFillIcon } from '@primer/octicons-react';
import Link from 'next/link';
import { withSidebar } from '../../components/Sidebar';
import { getServerHealth, getServers, getZombieProcessInfo, killProcesses } from '../../server/controllers/servers';
import Head from 'next/head';
import { useRpcQuery } from '../../hooks/useQuery';
import { toast } from 'react-hot-toast';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { assertUnreachable } from '../../utils/util-types';
import { useStreamingRpcQuery } from '../../hooks/useStreamingQuery';
import { HealthStatus } from '../../utils/shared-types';
import { RpcOutputType } from '../../utils/http';
import { Toggle } from '../../components/Toggle';
import { Alert, AlertCard } from '../../components/AlertCard';
import { Button } from '../../components/Button';
import { useRpcMutation } from '../../hooks/useMutation';
import { Spinner } from '../../components/Spinner';
import { Code } from '../../components/Code';

const ServiceStatusBadge: React.FC<{ status: HealthStatus }> = ({ status }) => {
    switch (status) {
        case HealthStatus.healthy:
            return <div className={'w-2 h-2 rounded-full bg-emerald-700'} />;
        case HealthStatus.zombie:
            return (
                <Tooltip content={'The dev server is running, but is not owned by sidekick.'} placement={'right'}>
                    <span className={'text-orange-600'}>
                        <AlertFillIcon />
                    </span>
                </Tooltip>
            );
        case HealthStatus.failing:
            return (
                <Tooltip content={'The dev server is failing to run.'} placement={'right'}>
                    <span className={'text-red-600'}>
                        <AlertFillIcon />
                    </span>
                </Tooltip>
            );
        case HealthStatus.none:
            return null;
        case HealthStatus.partial:
            return (
                <Tooltip content={'Some parts of this service are functional.'} placement={'right'}>
                    <div className={'w-2 h-2 rounded-full bg-orange-700'} />
                </Tooltip>
            );
        case HealthStatus.stale:
            return (
                <Tooltip
                    content={'No dev server is running, but the compiled version of this package is now out-of-date.'}
                    placement={'right'}
                >
                    <span className={'text-orange-700'}>{status}</span>
                </Tooltip>
            );
        case HealthStatus.paused:
            return (
                <Tooltip content={'You have paused the dev servers.'} placement={'right'}>
                    <span className={'text-orange-700'}>{status}</span>
                </Tooltip>
            );

        case undefined:
            return null;

        default:
            assertUnreachable(status);
            return <span>{status}</span>;
    }
};

function useServerName() {
    const router = useRouter();
    const { scopedName, serverName } = router.query;

    if (scopedName) {
        return `${serverName}/${scopedName}`;
    }
    return String(serverName);
}

const ServiceListEntry: React.FC<{
    serviceName: string;
    showAllServices: boolean;
    healthStatus: HealthStatus;
    onStatusUpdate(status: RpcOutputType<typeof getServerHealth>): void;
}> = ({ serviceName, showAllServices, healthStatus, onStatusUpdate }) => {
    const selectedServerName = useServerName();

    // TODO: Auto restart the stream if it ends
    useStreamingRpcQuery(
        getServerHealth,
        {
            name: serviceName
        },
        {
            onResult(result) {
                onStatusUpdate(result);
            }
        }
    );

    if (!showAllServices && selectedServerName !== serviceName && healthStatus === HealthStatus.none) {
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
                    <ServiceStatusBadge status={healthStatus} />
                </a>
            </Link>
        </li>
    );
};

const ServiceList: React.FC<{
    serviceStatuses: Record<string, RpcOutputType<typeof getServerHealth>>;
    setServiceStatuses(statuses: Record<string, RpcOutputType<typeof getServerHealth>>): void;
}> = ({ serviceStatuses, setServiceStatuses }) => {
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
};

const ZombieServiceControls: React.FC<{ serviceName: string }> = ({ serviceName }) => {
    const { data: processInfo, error: errLoadingProcessInfo } = useRpcQuery(getZombieProcessInfo, {
        name: serviceName
    });
    const { mutate: performKill, isLoading: isKilling } = useRpcMutation(killProcesses);

    return (
        <AlertCard title={`'${serviceName}' is in an undefined state`} borderColor={'border-orange-600'}>
            <p>
                Sidekick has detected a process running and responding on this service&apos;s ports, but the process is
                not owned by sidekick.
            </p>
            {!errLoadingProcessInfo && !processInfo && (
                <p className={'flex items-center mt-5'}>
                    <Spinner className={'text-black mr-2'} />
                    <span>Locating zombie processes ...</span>
                </p>
            )}
            {errLoadingProcessInfo && (
                <Alert className={'mt-5'}>Failed to load process info: {String(errLoadingProcessInfo)}</Alert>
            )}
            {processInfo && (
                <>
                    <Code>{JSON.stringify(processInfo, null, '\t')}</Code>

                    <Button
                        className={'mt-5'}
                        loading={isKilling}
                        onClick={() => {
                            performKill({
                                pids: processInfo.map(info => info.pid)
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

const ServiceControlPanel: React.FC<{
    serviceStatuses: Record<string, RpcOutputType<typeof getServerHealth>>;
    setServiceStatuses(statuses: Record<string, RpcOutputType<typeof getServerHealth>>): void;
}> = ({ serviceStatuses, setServiceStatuses }) => {
    const selectedServerName = useServerName();
    const selectedServerStatus = serviceStatuses[selectedServerName] ?? {
        healthStatus: HealthStatus.none,
        version: '(unknown)'
    };

    return (
        <>
            <h1 className={'text-2xl text-white font-bold mb-5'}>{selectedServerName}</h1>

            {selectedServerStatus.healthStatus === HealthStatus.zombie && (
                <ZombieServiceControls serviceName={selectedServerName} />
            )}
        </>
    );
};

export default withSidebar(function Servers() {
    const [serviceStatuses, setServiceStatuses] = useState<Record<string, RpcOutputType<typeof getServerHealth>>>({});

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

                    <div className={'w-3/4 p-5'}>
                        <ServiceControlPanel
                            serviceStatuses={serviceStatuses}
                            setServiceStatuses={setServiceStatuses}
                        />
                    </div>
                </div>
            </div>
        </>
    );
});
