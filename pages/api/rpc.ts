import { APIError, route, validate } from '../../utils/http';
import { getConfig, updateConfig } from './config';
import { getExtensions, runExtensionMethod } from './extensions';
import { getServers } from './servers';
import * as t from 'io-ts';

const methods = {
    getConfig,
    updateConfig,

    getExtensions,
    runExtensionMethod,

    getServers
};

export default route(async (req, res) => {
    const { methodName } = validate(
        t.interface({
            methodName: t.string,
            data: t.unknown
        }),
        req.body
    );
    const method = methods[methodName];
    if (!method) {
        throw new APIError(`Unrecognized method name: ${methodName}`);
    }
    return method(req, res);
});
