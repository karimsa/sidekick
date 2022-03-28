import * as React from 'react';
import { HealthStatus } from '../utils/shared-types';
import Tooltip from '@tippyjs/react';
import { AlertFillIcon, XCircleFillIcon } from '@primer/octicons-react';
import { assertUnreachable } from '../utils/util-types';

export const ServiceStatusBadge: React.FC<{ status: HealthStatus; error?: string }> = ({ status, error }) => {
    switch (status) {
        case HealthStatus.healthy:
            return <div className={'w-2 h-2 rounded-full bg-emerald-700'} />;
        case HealthStatus.zombie:
            return (
                <Tooltip content={'The dev server is running, but is not owned by sidekick.'} placement={'right'}>
                    <span className={'text-orange-300'}>
                        <AlertFillIcon />
                    </span>
                </Tooltip>
            );
        case HealthStatus.failing:
            return (
                <Tooltip content={error || 'The dev server is failing to run.'} placement={'right'}>
                    <span className={'text-red-500'}>
                        <XCircleFillIcon />
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
