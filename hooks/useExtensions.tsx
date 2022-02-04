import * as React from 'react';
import { useMemo } from 'react';
import { useRpcQuery } from './useQuery';
import * as ReactQuery from 'react-query';
import { getExtensions, runExtensionMethod } from '../pages/api/extensions';
import octicons from '@primer/octicons';
import { loadModule } from '../utils/load-module';

function createUseExtensionQuery(extensionPath: string) {
    return function useExtensionQuery(methodName: string, params: any[]) {
        const { data, ...props } = useRpcQuery(runExtensionMethod, {
            extensionPath,
            methodName,
            params
        });
        return { ...props, data: data?.result };
    };
}

export function useExtensions() {
    const { data, error: errFetchingExtensions, ...props } = useRpcQuery(getExtensions, {});
    const { data: extensions, error: errLoadingExtensions } = useMemo(() => {
        try {
            return {
                data: data?.map(({ id, extensionPath, code }) => {
                    const { config, Page } = loadModule(code, {
                        UseSidekickQuery: createUseExtensionQuery(extensionPath),
                        require(modName: string) {
                            switch (modName) {
                                case 'react':
                                    return React;
                                case 'react-query':
                                    return ReactQuery;
                                default:
                                    throw new Error(`Failed to bundle '${modName}' (source: ${id})`);
                            }
                        }
                    }) as any;

                    const icon = octicons[config.icon];
                    if (!icon) {
                        throw new Error(`Unexpected icon: ${config.icon} (source: ${id})`);
                    }

                    return { id, icon: icon.toSVG(), config, Page };
                })
            };
        } catch (error: any) {
            return { error };
        }
    }, [data]);
    return { extensions, error: errFetchingExtensions || errLoadingExtensions, ...props };
}
