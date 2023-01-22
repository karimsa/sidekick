import { type AxiosError } from 'axios';
import omit from 'lodash/omit';
import { useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
	UseMutationOptions,
	UseQueryOptions,
	UseQueryResult,
} from 'react-query';
import { z } from 'zod';

import { useRpcMutation } from '../hooks/useMutation';
import {
	useQueryInvalidator as useInternalQueryInvalidator,
	useRpcQuery,
} from '../hooks/useQuery';
import { getConfig, updateConfig } from '../server/controllers/config';
import { runExtensionMethod } from '../server/controllers/extensions';
import type { RpcInputType, RpcOutputType } from '../server/utils/http';

// @ts-ignore
import { config as extensionConfig } from 'sidekick-extension-config';

export function useConfig<T>(schema: z.Schema<T>): {
	data?: T;
	error?: Error;
	isLoading: boolean;
	updateConfig(updates: T): void;
} {
	const {
		data: config,
		error: errFetchingConfig,
		isLoading: isLoadingConfig,
	} = useRpcQuery(getConfig, {});

	const {
		error: errUpdatingConfig,
		isLoading: isUpdatingConfig,
		mutate: performUpdate,
	} = useRpcMutation(updateConfig);
	const updateConfigWrapper = useCallback(
		(updates: T) => {
			if (!config) {
				throw new Error(`Config has not loaded yet, cannot perform an update`);
			}
			performUpdate({
				...config,
				extensions: {
					...config.extensions,
					[extensionConfig.id]: schema.parse(updates),
				},
			});
		},
		[config, performUpdate, schema],
	);

	return {
		data: extensionConfig,
		error: (errFetchingConfig || errUpdatingConfig) ?? undefined,
		isLoading: isLoadingConfig || isUpdatingConfig,
		updateConfig: updateConfigWrapper,
	};
}

export function useTargetEnvironments(): {
	data?: string[];
	error?: Error;
	isLoading: boolean;
} {
	const { data: config, error, isLoading } = useRpcQuery(getConfig, {});
	const targetEnvs = useMemo(() => {
		return config ? Object.keys(config.environments) : undefined;
	}, [config]);
	return { data: targetEnvs, error: error ?? undefined, isLoading };
}

export function useToaster() {
	return { toast };
}

export function useQuery<Params, Result>(
	method: (params: Params) => Promise<Result>,
	params: Params,
	options?: {
		queryOptions?: Omit<
			UseQueryOptions<Result, Error, Params>,
			'queryFn' | 'queryKey' | 'queryHash' | 'queryKeyHashFn'
		>;
		nodeOptions?: string[];
		targetEnvironment?: string;
		environment?: Record<string, string>;
	},
): UseQueryResult<Result, AxiosError | Error> {
	const { data, ...props } = useRpcQuery(
		runExtensionMethod,
		{
			extensionId: extensionConfig.id,
			methodName: String(method),
			params,
			targetEnvironment: options?.targetEnvironment,
			environment: options?.environment,
			nodeOptions: options?.nodeOptions,
		},
		{
			retry: false,
			...(options?.queryOptions ?? {}),
		} as any,
	);
	return { ...props, data: data?.result } as any;
}

export function useQueryInvalidator() {
	const invalidate = useInternalQueryInvalidator();
	return function (method: (params: any) => Promise<any>) {
		invalidate(runExtensionMethod, { methodName: String(method) });
	};
}

export function useMutation<Params, Result>(
	methodName: string,
	options?: {
		mutationOptions?: Omit<
			UseMutationOptions<Result, Error, Params>,
			'mutationFn' | 'mutationKey'
		>;
	},
) {
	const wrappedOptions = useMemo(() => {
		const mutationOpts: UseMutationOptions<
			RpcOutputType<typeof runExtensionMethod>,
			Error,
			RpcInputType<typeof runExtensionMethod>
		> = omit(options?.mutationOptions ?? {}, [
			'onSuccess',
			'onError',
			'onMutate',
			'onSettled',
		]);
		const { onSuccess, onError, onMutate, onSettled } =
			options?.mutationOptions ?? {};

		if (onSuccess) {
			mutationOpts.onSuccess = (data, { params }, ctx) =>
				onSuccess(data.result, params as Params, ctx);
		}
		if (onError) {
			mutationOpts.onError = (error, { params }, ctx) =>
				onError(error, params as Params, ctx);
		}
		if (onMutate) {
			mutationOpts.onMutate = ({ params }) => onMutate(params as Params);
		}
		if (onSettled) {
			mutationOpts.onSettled = (data, error, { params }, ctx) =>
				onSettled(data?.result, error, params as Params, ctx);
		}

		return mutationOpts;
	}, [options?.mutationOptions]);
	const { data, mutate, ...props } = useRpcMutation(
		runExtensionMethod,
		wrappedOptions as any,
	);
	const mutateWrapper = useCallback(
		(
			params: Params,
			options?: {
				nodeOptions?: string[];
				targetEnvironment?: string;
				environment?: Record<string, string>;
			},
		) => {
			mutate({
				extensionId: extensionConfig.id,
				methodName,
				params,
				targetEnvironment: options?.targetEnvironment,
				environment: options?.environment,
				nodeOptions: options?.nodeOptions,
			});
		},
		[methodName, mutate],
	);

	return {
		...props,
		data: data?.result,
		mutate: mutateWrapper,
	};
}
