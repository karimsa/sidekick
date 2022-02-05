import * as React from 'react';
import { useMemo } from 'react';
import { useRpcQuery } from './useQuery';
import { getExtensions, runExtensionMethod } from '../pages/api/extensions';
import octicons from '@primer/octicons';
import { loadModule } from '../utils/load-module';
import toast from 'react-hot-toast';
import { UseQueryOptions } from 'react-query';
import * as t from 'io-ts';
import { getConfig, updateConfig } from '../pages/api/config';
import { useRpcMutation } from './useMutation';
import { validate } from '../utils/http';

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

            return {
                data: extensionConfig,
                error: errFetchingConfig || errUpdatingConfig,
                isLoading: isLoadingConfig || isUpdatingConfig,
                updateConfig(updates: T) {
                    performUpdate({
                        ...config,
                        extensions: {
                            ...config.extensions,
                            [extensionId]: validate(schema, updates)
                        }
                    });
                }
            };
        }
    };
}

export function useExtensions() {
    const { data, error: errFetchingExtensions, ...props } = useRpcQuery(getExtensions, {});
    const { data: extensions, error: errLoadingExtensions } = useMemo(() => {
        try {
            return {
                data: data?.flatMap(({ id, extensionPath, code }) => {
                    try {
                        const helpers = {};
                        const { config, Page } = loadModule(code, {
                            // these cannot be bundled and must be loaded at runtime
                            require(modName: string) {
                                switch (modName) {
                                    case 'react':
                                        return React;
                                    case 'sidekick/extension':
                                        return helpers;
                                    default:
                                        throw new Error(`Failed to bundle '${modName}' (source: ${id})`);
                                }
                            }
                        }) as any;

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
                        return [{ id, icon: icon.toSVG(), config, Page }];
                    } catch (error: any) {
                        toast.error(`Failed to load extension from ${extensionPath}: ${String(error)}`, {
                            id: `load-extension-${extensionPath}`
                        });
                        return [];
                    }
                })
            };
        } catch (error: any) {
            return { error };
        }
    }, [data]);
    return { extensions, error: errFetchingExtensions || errLoadingExtensions, ...props };
}
