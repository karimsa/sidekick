import {
	UseMutationOptions,
	UseMutationResult,
	UseQueryOptions,
	UseQueryResult,
} from 'react-query';
import { AxiosError } from 'axios';
import { toast } from 'react-hot-toast';
import { z } from 'zod';

declare module '@karimsa/sidekick/extension' {
	interface AsyncResult<T> {
		data: T | null;
		isLoading: boolean;
		error: any;
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
	): UseQueryResult<Result, AxiosError | Error>;

	export function useQueryInvalidator(): (
		method: (args: any) => Promise<any>,
	) => void;

	export function useMutation<Params, Result>(
		method: (params: Params) => Promise<Result>,
		options?: {
			mutationOptions?: Omit<
				UseMutationOptions<Result, Error, Params>,
				'mutationFn' | 'mutationKey'
			>;
		},
	): Omit<UseMutationResult<Result, Error, never>, 'mutate'> & {
		mutate(
			params: Params,
			options?: {
				mutationOptions?: Omit<
					UseMutationOptions<Result, Error, Params>,
					'mutationFn' | 'mutationKey'
				>;
				nodeOptions?: string[];
				targetEnvironment?: string;
				environment?: Record<string, string>;
			},
		): void;
	};

	export function useConfig<T>(schema: z.Schema<T>): AsyncResult<T> & {
		updateConfig(updates: T): void;
	};

	export function useTargetEnvironments(): AsyncResult<string[]>;

	export function useToaster(): { toast: typeof toast };
}
