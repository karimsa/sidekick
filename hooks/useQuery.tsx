import {
	useQuery,
	useQueryClient,
	UseQueryOptions,
	UseQueryResult,
} from 'react-query';

import axios from 'axios';
import type { RpcHandler } from '../server/utils/http';

function useRpcQueryInternal<InputType, OutputType>(
	// this is the type of the handler at runtime
	handler: { methodName: string },
	data: InputType,
	options?: UseQueryOptions<OutputType>,
) {
	return useQuery<OutputType>({
		...options,
		queryKey: [handler, data],
		async queryFn(inputData): Promise<OutputType> {
			try {
				const { data: resData } = await axios.post(
					`http://${location.hostname}:9010/api/rpc/${handler.methodName}`,
					inputData.queryKey[1],
				);
				return resData;
			} catch (error: any) {
				const decodedError = error.response?.data.error;
				if (decodedError) {
					throw new Error(decodedError);
				}
				throw error;
			}
		},
	});
}

export function useQueryInvalidator() {
	const queryClient = useQueryClient();
	return function <InputType>(
		handler: RpcHandler<InputType, any>,
		input?: Partial<InputType>,
	) {
		const { methodName } = handler as unknown as { methodName: string };
		queryClient.invalidateQueries([{ methodName, data: input }]);
	};
}

export function useRpcQuery<InputType, OutputType>(
	// this is the type of the handler at compile-time
	handler: RpcHandler<InputType, OutputType>,
	data: InputType,
	options?: UseQueryOptions<any>,
): UseQueryResult<OutputType, Error> {
	return useRpcQueryInternal(handler as any, data, options) as any;
}
