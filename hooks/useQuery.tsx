import {
    useQuery,
    UseQueryOptions,
    QueryFunctionContext,
    UseQueryResult,
} from 'react-query'

import axios from 'axios'
import type { RpcHandler } from '../utils/http'
import { MethodToRoute } from './bridge-method-map'

function useRpcQueryInternal<InputType, OutputType>(
    // this is the type of the handler at runtime
    handler: { methodName: string },
    data: InputType,
    options?: UseQueryOptions<OutputType>,
) {
    return useQuery<OutputType>({
        ...options,
        queryKey: [handler, data],
        async queryFn(inputData: QueryFunctionContext): Promise<OutputType> {
            const { data: resData } = await axios.post(MethodToRoute[handler.methodName]!, {
                ...handler,
                data: inputData.queryKey[1],
            })
            return resData
        },
    })
}

export function useRpcQuery<InputType, OutputType>(
    // this is the type of the handler at compile-time
    handler: RpcHandler<InputType, OutputType>,
    data: InputType,
    options?: UseQueryOptions<OutputType>,
): UseQueryResult<OutputType, Error> {
    return useRpcQueryInternal(handler as any, data, options) as any
}
