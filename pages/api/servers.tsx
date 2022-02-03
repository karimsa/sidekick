import * as t from 'io-ts';

import { ConfigManager } from '../../services/config';
import { ServerManager } from '../../services/server-manager';
import { routes, createRpcMethod } from '../../utils/http';

export const getServers = createRpcMethod(t.interface({}), async function () {
    return ServerManager.getServiceList();
});

export default routes({
    getServers
});
