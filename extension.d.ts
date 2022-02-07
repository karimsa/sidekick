import { UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from 'react-query';
import { AxiosError } from 'axios';
import * as t from 'io-ts';
import { toast } from 'react-hot-toast';

declare module 'sidekick/extension' {
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
        }
    ): UseQueryResult<Result, AxiosError | Error>;

    export function useQueryInvalidator(): (method: (args: any) => Promise<any>) => void;

    export function useMutation<Params, Result>(
        method: (params: Params) => Promise<Result>,
        options?: {
            mutationOptions?: Omit<UseMutationOptions<Result, Error, Params>, 'mutationFn' | 'mutationKey'>;
        }
    ): Omit<UseMutationResult<Result, Error, never>, 'mutate'> & {
        mutate(
            params: Params,
            options?: {
                mutationOptions?: Omit<UseMutationOptions<Result, Error, Params>, 'mutationFn' | 'mutationKey'>;
                nodeOptions?: string[];
                targetEnvironment?: string;
                environment?: Record<string, string>;
            }
        ): void;
    };

    export function useConfig<T>(schema: t.Type<T>): {
        data?: T;
        error?: Error;
        isLoading: boolean;
        updateConfig(updates: T): void;
    };

    export function useTargetEnvironments(): { data?: string[]; error?: Error; isLoading: boolean };

    export function useToaster(): { toast: typeof toast };
}
