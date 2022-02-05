import { QueryFunctionContext, useQuery, useQueryClient, UseQueryOptions, UseQueryResult } from 'react-query';

import axios from 'axios';
import type { RpcHandler } from '../utils/http';

function useRpcQueryInternal<InputType, OutputType>(
    // this is the type of the handler at runtime
    handler: { methodName: string },
    data: InputType,
    options?: UseQueryOptions<OutputType>
) {
    return useQuery<OutputType>({
        ...options,
        queryKey: [handler, data],
        async queryFn(inputData: QueryFunctionContext): Promise<OutputType> {
            try {
                const { data: resData } = await axios.post('/api/rpc', {
                    ...handler,
                    data: inputData.queryKey[1]
                });
                return resData;
            } catch (error: any) {
                const decodedError = error.response?.data.error;
                if (decodedError) {
                    throw new Error(decodedError);
                }
                throw error;
            }
        }
    });
}

export function useQueryInvalidator() {
    const queryClient = useQueryClient();
    return function (handler: RpcHandler<any, any>) {
        const { methodName } = handler as unknown as { methodName: string };
        queryClient.invalidateQueries([{ methodName }]);
    };
}

export function useRpcQuery<InputType, OutputType>(
    // this is the type of the handler at compile-time
    handler: RpcHandler<InputType, OutputType>,
    data: InputType,
    options?: UseQueryOptions<OutputType>
): UseQueryResult<OutputType, Error> {
    return useRpcQueryInternal(handler as any, data, options) as any;
}
