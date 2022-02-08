import * as t from 'io-ts';
import { createRpcMethod } from '../../utils/http';
import { ServiceList } from '../../services/service-list';

export const getServers = createRpcMethod(t.interface({}), async function () {
    return ServiceList.getServices();
});
