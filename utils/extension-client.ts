import axios from 'axios';
import { useQuery as useReactQuery } from 'react-query';

const extensionName = process.env.SIDEKICK_EXTENSION_NAME;

export function useQuery(methodName: string, args: any[]) {
    return useReactQuery({
        queryKey: [{ extensionName, methodName, args }],
        async queryFn(ctx) {
            const { extensionName, methodName, args } = ctx.queryKey[0];
            const { data } = await axios.post('/api/extensions/proxy', {
                extensionName,
                methodName,
                args
            });
            return data;
        }
    });
}
