import { UseQueryOptions, UseQueryResult } from 'react-query';
import { AxiosError } from 'axios';

declare module 'sidekick/extension' {
    export function useQuery<Params, Result>(
        method: (...args: Params) => Promise<Result>,
        params: Params,
        options?: {
            queryOptions?: Omit<UseQueryOptions, 'queryFn' | 'queryKey' | 'queryHash' | 'queryKeyHashFn'>;
            targetEnvironment?: string;
            environment?: Record<string, string>;
        }
    ): UseQueryResult<Result, AxiosError | Error>;
}
