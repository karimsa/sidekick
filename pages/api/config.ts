import * as t from 'io-ts';

import { ConfigProvider } from '../../utils/config';
import { ApiRequest, routes, createRpcMethod } from '../../utils/http';

export const getConfig = createRpcMethod(t.interface({}), async function () {
    return ConfigProvider.getAll();
})

export const updateConfig = createRpcMethod(t.record(t.string, t.unknown), async function (req) {
    // any is valid here, the config provider performs validation
    await ConfigProvider.setAll(req.body as any);
    return ConfigProvider.getAll();
})

export default routes({
    getConfig,
    updateConfig,
});
