import { UseQueryOptions, UseQueryResult } from 'react-query';
import { AxiosError } from 'axios';
import * as t from 'io-ts';

declare module 'sidekick/extension' {
    export function useQuery<Params, Result>(
        method: (...args: Params) => Promise<Result>,
        params: Params,
        options?: {
            queryOptions?: Omit<UseQueryOptions, 'queryFn' | 'queryKey' | 'queryHash' | 'queryKeyHashFn'>;
            nodeOptions?: string[];
            targetEnvironment?: string;
            environment?: Record<string, string>;
        }
    ): UseQueryResult<Result, AxiosError | Error>;

    export function useConfig<T>(schema: t.Type<T>): {
        data?: T;
        error?: Error;
        isLoading: boolean;
        updateConfig(updates: T): void;
    };
}
