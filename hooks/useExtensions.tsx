import * as React from 'react';
import { useMemo } from 'react';
import { useRpcQuery } from './useQuery';
import { getExtensions, runExtensionMethod } from '../pages/api/extensions';
import octicons from '@primer/octicons';
import { loadModule } from '../utils/load-module';
import toast from 'react-hot-toast';

function createExtensionHelpers(extensionPath: string) {
    return {
        useQuery(methodName: string, params: any[]) {
            const { data, ...props } = useRpcQuery(
                runExtensionMethod,
                {
                    extensionPath,
                    methodName,
                    params
                },
                {
                    retry: false
                }
            );
            return { ...props, data: data?.result };
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
                        const helpers = createExtensionHelpers(extensionPath);
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

                        const icon = octicons[config.icon];
                        if (!icon) {
                            throw new Error(`Unrecognized icon: ${config.icon}`);
                        }

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
