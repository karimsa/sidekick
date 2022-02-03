import * as t from 'io-ts';

import { ConfigManager } from '../../services/config';
import { routes, createRpcMethod } from '../../utils/http';

export const getConfig = createRpcMethod(t.interface({}), async function () {
    const config = await ConfigManager.createProvider();
    return config.getAll();
});

export const updateConfig = createRpcMethod(t.record(t.string, t.unknown), async function (req) {
    const config = await ConfigManager.createProvider();
    // any is valid here, the config provider performs validation
    await config.setAll(req.body as any);
    return config.getAll();
});

export default routes({
    getConfig,
    updateConfig
});
