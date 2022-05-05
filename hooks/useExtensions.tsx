import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { useQueryInvalidator, useRpcQuery } from './useQuery';
import {
	getExtensionClient,
	runExtensionMethod,
} from '../server/controllers/extensions';
// @ts-ignore
import octicons from '@primer/octicons';
import toast from 'react-hot-toast';
import { UseMutationOptions, UseQueryOptions } from 'react-query';
import { z } from 'zod';
import { getConfig, updateConfig } from '../server/controllers/config';
import { useRpcMutation } from './useMutation';
import { RpcInputType, RpcOutputType, validate } from '../server/utils/http';
import * as ReactDOM from 'react-dom';
import { useRouter } from 'next/router';
import { loadModule } from '../server/utils/load-module';
import omit from 'lodash/omit';
import * as tslib from 'tslib';

function createExtensionHelpers(extensionId: string) {
	return {
		useQuery(
			methodName: string,
			params: any,
			options?: {
				queryOptions?: Omit<
					UseQueryOptions,
					'queryFn' | 'queryKey' | 'queryHash' | 'queryKeyHashFn'
				>;
				nodeOptions?: string[];
				targetEnvironment?: string;
				environment?: Record<string, string>;
			},
		) {
			const { data, ...props } = useRpcQuery(
				runExtensionMethod,
				{
					extensionId,
					methodName,
					params,
					targetEnvironment: options?.targetEnvironment,
					environment: options?.environment,
					nodeOptions: options?.nodeOptions,
				},
				{
					retry: false,
					...(options?.queryOptions ?? {}),
				},
			);
			return { ...props, data: data?.result };
		},

		useQueryInvalidator() {
			const invalidate = useQueryInvalidator();
			return function (methodName: string) {
				invalidate(runExtensionMethod, { methodName });
			};
		},

		useMutation<Params, Result>(
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
						extensionId,
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
		},

		useConfig<T extends Record<string, unknown>>(
			schema: z.Schema<T>,
		): {
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
			const extensionConfig = useMemo<T | undefined>(() => {
				if (config) {
					return (config.extensions[extensionId] ?? {}) as any;
				}
			}, [config]);

			const {
				error: errUpdatingConfig,
				isLoading: isUpdatingConfig,
				mutate: performUpdate,
			} = useRpcMutation(updateConfig);
			const updateConfigWrapper = useCallback(
				(updates: T) => {
					if (!config) {
						throw new Error(
							`Config has not loaded yet, cannot perform an update`,
						);
					}
					performUpdate({
						...config,
						extensions: {
							...config.extensions,
							[extensionId]: validate(schema, updates),
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
		},

		useTargetEnvironments(): {
			data?: string[];
			error?: Error;
			isLoading: boolean;
		} {
			const { data: config, error, isLoading } = useRpcQuery(getConfig, {});
			const targetEnvs = useMemo(() => {
				return config ? Object.keys(config.environments) : undefined;
			}, [config]);
			return { data: targetEnvs, error: error ?? undefined, isLoading };
		},

		useToaster() {
			return { toast };
		},
	};
}

export interface CompiledExtension {
	id: string;
	icon: string;
	code: string;
	warnings: string[];
	name: string;
	Page: React.FC;
}

const extensionCache = new Map<string, CompiledExtension>();

export function getExtensionIcon(name: string) {
	const icon = octicons[name];
	if (!icon) {
		console.error(`Unrecognized icon: ${name}`);
		return '';
	}
	return icon.toSVG();
}

export function useExtension(extensionId?: string) {
	const { data, error, ...props } = useRpcQuery(
		getExtensionClient,
		{
			id: extensionId,
		},
		{
			enabled: !!extensionId,
		},
	);
	const { extension, error: extensionError } = useMemo<
		| { extension: CompiledExtension; error: null }
		| { extension: null; error: any }
		| { extension: null; error: null }
	>(() => {
		if (!data || !extensionId) {
			return { extension: null, error: null };
		}

		const { config, code, warnings } = data;
		if (!config) {
			return { extension: null, error: `Unexpected error` };
		}

		const cachedExtension = extensionCache.get(extensionId);
		if (cachedExtension) {
			const updateWarning = `Your extension has changed. Please refresh to update.`;
			if (
				code !== cachedExtension.code &&
				!cachedExtension.warnings.includes(updateWarning)
			) {
				cachedExtension.warnings.push(updateWarning);
			}

			return { extension: cachedExtension, error: null };
		}

		try {
			console.log(`Loading extension: ${extensionId}`);
			const helpers = {};

			const { Page } = loadModule(code, {
				// these cannot be bundled and must be loaded at runtime
				require(modName: string) {
					switch (modName) {
						case 'react':
							return React;
						case 'react-dom':
							return ReactDOM;
						case 'next/router':
							return { useRouter };
						case '@karimsa/sidekick/extension':
							return helpers;
						case 'tslib':
							return tslib;
						default:
							throw new Error(`Failed to bundle '${modName}'`);
					}
				},
			});

			Object.assign(helpers, createExtensionHelpers(config.id));
			const compiled: CompiledExtension = {
				id: config.id,
				icon: getExtensionIcon(config.icon),
				code,
				warnings,
				name: config.name,
				Page,
			};
			extensionCache.set(extensionId, compiled);
			return { extension: compiled, error: null };
		} catch (error: any) {
			return { extension: null, error };
		}
	}, [data, extensionId]);
	return { extension, error: error || extensionError, ...props };
}
