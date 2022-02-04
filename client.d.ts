import { UseQueryResult } from 'react-query';
import { AxiosError } from 'axios';

declare module 'sidekick/client' {
    export function useQuery<Params, Result>(
        method: (...args: Params) => Promise<Result>,
        params: Params
    ): UseQueryResult<Result, AxiosError | Error>;
}
