import constate from 'constate';
import { useStreamingRpcQuery } from './useStreamingQuery';
import { getBulkServerHealth } from '../server/controllers/servers';
import { useCallback, useEffect, useMemo } from 'react';
import { HealthStatus } from '../server/utils/shared-types';
import { RpcOutputType } from '../server/utils/http';
import { toast } from 'react-hot-toast';

export type BulkServiceStatus = Record<
	string,
	{ healthStatus: HealthStatus; tags: string[]; version: string }
>;

export const DefaultServiceStatus = {
	healthStatus: HealthStatus.none,
	tags: ['all'],
	version: '(unknown)',
};

interface BulkServiceState {
	serviceStatuses: BulkServiceStatus;
	error: string | null;
}

export const [BulkServiceHealthProvider, useBulkServiceHealth] = constate(
	function () {
		const { data } = useStreamingRpcQuery<
			object,
			RpcOutputType<typeof getBulkServerHealth>,
			BulkServiceState
		>(
			getBulkServerHealth,
			useMemo(() => ({}), []),
			useCallback((state, action): BulkServiceState => {
				switch (action.type) {
					case 'open':
						return { serviceStatuses: {}, error: null };
					case 'data':
						return {
							serviceStatuses: {
								...state.serviceStatuses,
								[action.data.serviceName]: {
									...action.data,
									...action.data.healthInfo,
								},
							},
							error: null,
						};
					case 'error':
						return { ...state, error: action.error };
					case 'end':
						return state;
				}
			}, []),
			{ serviceStatuses: {}, error: null },
		);
		useEffect(() => {
			if (data.error) {
				toast.error(data.error, { id: 'bulk-health-check' });
			}
		}, [data.error]);

		return data.serviceStatuses;
	},
);

export function withBulkServiceHealthProvider<T>(
	Component: React.FC<T>,
): React.FC<T> {
	return function BulkServiceHealthConsumer(props: T) {
		return (
			<BulkServiceHealthProvider>
				<Component {...props} />
			</BulkServiceHealthProvider>
		);
	};
}
