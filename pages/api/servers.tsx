import * as t from 'io-ts';
import { createRpcMethod, routes } from '../../utils/http';
import { ServiceList } from '../../services/service-list';

export const getServers = createRpcMethod(t.interface({}), async function () {
    // return ServerManager.getServiceList();

    return ServiceList.getServices();
});

export default routes({
    getServers
});
