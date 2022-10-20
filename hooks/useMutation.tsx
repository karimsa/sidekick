import {
	useMutation,
	UseMutationOptions,
	UseMutationResult,
} from 'react-query';

import axios from 'axios';
import type { RpcHandler } from '../server/utils/http';
import { Config } from './config';

function useRpcMutationInternal<InputType, OutputType>(
	// this is the type of the handler at runtime
	handler: { methodName: string },
	options?: UseMutationOptions<OutputType, unknown, InputType>,
) {
	return useMutation({
		...options,
		async mutationFn(inputData: InputType): Promise<OutputType> {
			try {
				const { data: resData } = await axios.post(
					`http://${location.hostname}:${Config.ServerPort}/api/rpc/${handler.methodName}`,
					inputData,
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

export function useRpcMutation<InputType, OutputType>(
	// this is the type of the handler at compile-time
	handler: RpcHandler<InputType, OutputType>,
	options?: UseMutationOptions<any, unknown, any>,
): UseMutationResult<OutputType, Error, InputType> {
	return useRpcMutationInternal(handler as any, options) as any;
}
