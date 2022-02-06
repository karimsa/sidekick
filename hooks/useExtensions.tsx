import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { useQueryInvalidator, useRpcQuery } from './useQuery';
import { getExtensions, runExtensionMethod } from '../pages/api/extensions';
import octicons from '@primer/octicons';
import toast from 'react-hot-toast';
import { UseMutationOptions, UseQueryOptions } from 'react-query';
import * as t from 'io-ts';
import { getConfig, updateConfig } from '../pages/api/config';
import { useRpcMutation } from './useMutation';
import { validate } from '../utils/http';
import * as ReactDOM from 'react-dom';
import { useRouter } from 'next/router';
import { loadModule } from '../utils/load-module';

function createExtensionHelpers(extensionId: string, extensionPath: string) {
    return {
        useQuery(
            methodName: string,
            params: any[],
            options?: {
                queryOptions?: Omit<UseQueryOptions, 'queryFn' | 'queryKey' | 'queryHash' | 'queryKeyHashFn'>;
                nodeOptions?: string[];
                targetEnvironment?: string;
                environment?: Record<string, string>;
            }
        ) {
            const { data, ...props } = useRpcQuery(
                runExtensionMethod,
                {
                    extensionPath,
                    methodName,
                    params,
                    targetEnvironment: options?.targetEnvironment,
                    environment: options?.environment,
                    nodeOptions: options?.nodeOptions
                },
                {
                    retry: false,
                    ...(options?.queryOptions ?? {})
                }
            );
            return { ...props, data: data?.result };
        },

        // TODO: Allow selective invalidation
        useQueryInvalidator() {
            const invalidate = useQueryInvalidator();
            return function () {
                invalidate(runExtensionMethod);
            };
        },

        useMutation(
            methodName: string,
            options?: {
                mutationOptions?: Omit<UseMutationOptions, 'mutationFn' | 'mutationKey'>;
            }
        ) {
            const { data, mutate, ...props } = useRpcMutation(runExtensionMethod, options?.mutationOptions);
            const mutateWrapper = useCallback(
                (
                    params: any[],
                    options?: {
                        nodeOptions?: string[];
                        targetEnvironment?: string;
                        environment?: Record<string, string>;
                    },
                    mutationOptions?: Omit<UseMutationOptions, 'mutationFn' | 'mutationKey'>
                ) => {
                    mutate(
                        {
                            extensionPath,
                            methodName,
                            params,
                            targetEnvironment: options?.targetEnvironment,
                            environment: options?.environment,
                            nodeOptions: options?.nodeOptions
                        },
                        mutationOptions as any
                    );
                },
                [methodName, mutate]
            );

            return {
                ...props,
                data: data?.result,
                mutate: mutateWrapper
            };
        },

        useConfig<T extends Record<string, unknown>>(
            schema: t.Type<T>
        ): {
            data?: T;
            error: Error;
            isLoading: boolean;
            updateConfig(updates: T): void;
        } {
            const { data: config, error: errFetchingConfig, isLoading: isLoadingConfig } = useRpcQuery(getConfig, {});
            const extensionConfig = useMemo<T | undefined>(() => {
                if (config) {
                    return (config.extensions[extensionId] ?? {}) as any;
                }
            }, [config]);

            const {
                error: errUpdatingConfig,
                isLoading: isUpdatingConfig,
                mutate: performUpdate
            } = useRpcMutation(updateConfig);
            const updateConfigWrapper = useCallback(
                (updates: T) => {
                    performUpdate({
                        ...config,
                        extensions: {
                            ...config.extensions,
                            [extensionId]: validate(schema, updates)
                        }
                    });
                },
                [config, performUpdate, schema]
            );

            return {
                data: extensionConfig,
                error: errFetchingConfig || errUpdatingConfig,
                isLoading: isLoadingConfig || isUpdatingConfig,
                updateConfig: updateConfigWrapper
            };
        },

        useTargetEnvironments(): { data?: string[]; error?: Error; isLoading: boolean } {
            const { data: config, error, isLoading } = useRpcQuery(getConfig, {});
            const targetEnvs = useMemo(() => {
                return config ? Object.keys(config.environments) : undefined;
            }, [config]);
            return { data: targetEnvs, error, isLoading };
        }
    };
}

export interface CompiledExtension {
    id: string;
    icon: string;
    code: string;
    warnings: string[];
    title: string;
    Page: React.FC;
}

const extensionCache = new Map<string, CompiledExtension>();

export function useExtensions() {
    const { data, ...props } = useRpcQuery(getExtensions, {});

    const extensions = useMemo<CompiledExtension[] | undefined>(() => {
        return data?.flatMap(({ extensionPath, code, warnings }) => {
            const cachedExtension = extensionCache.get(extensionPath);
            if (cachedExtension) {
                const updateWarning = `Your extension has changed. Please refresh to update.`;
                if (code !== cachedExtension.code && !cachedExtension.warnings.includes(updateWarning)) {
                    cachedExtension.warnings.push(updateWarning);
                }

                return [cachedExtension];
            }

            try {
                console.log(`Loading extension: ${extensionPath}`);
                const helpers = {};

                const { config, Page } = loadModule(code, {
                    // these cannot be bundled and must be loaded at runtime
                    require(modName: string) {
                        switch (modName) {
                            case 'react':
                                return React;
                            case 'react-dom':
                                return ReactDOM;
                            case 'next/router':
                                return { useRouter };
                            case 'sidekick/extension':
                                return helpers;
                            default:
                                throw new Error(`Failed to bundle '${modName}'`);
                        }
                    }
                });

                if (!config) {
                    throw new Error(`Missing 'config' export`);
                }
                if (!config.id) {
                    throw new Error(`Extension is missing an 'id' (export using config)`);
                }

                const icon = octicons[config.icon];
                if (!icon) {
                    throw new Error(`Unrecognized icon: ${config.icon}`);
                }

                Object.assign(helpers, createExtensionHelpers(config.id, extensionPath));
                const compiled: CompiledExtension = {
                    id: config.id,
                    icon: icon.toSVG(),
                    code,
                    warnings,
                    title: config.title,
                    Page
                };
                extensionCache.set(extensionPath, compiled);
                return [compiled];
            } catch (error: any) {
                toast.error(`Failed to load extension from ${extensionPath}: ${String(error)}`, {
                    id: `loading-${extensionPath}`
                });
                return [];
            }
        });
    }, [data]);
    return { extensions, ...props };
}
