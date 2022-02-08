import express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http';
import cors from 'cors';

import { fmt } from '../utils/fmt';
import { APIError, route, validate } from '../utils/http';
import * as t from 'io-ts';
import { getConfig, updateConfig } from './controllers/config';
import { getExtensions, runExtensionMethod } from './controllers/extensions';
import { getServers } from './controllers/servers';

const app = express();

const methods = {
    getConfig,
    updateConfig,

    getExtensions,
    runExtensionMethod,

    getServers
};

app.use(bodyParser.json({ limit: 1024 }));
app.use(cors({ origins: ['http://localhost:9001'] }));
app.post(
    '/api/rpc',
    route(async (req, res) => {
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
    })
);

const server = http.createServer(app);
server.listen(process.env.PORT || 9002, () => {
    console.log(fmt`Sidekick server listening on :${server.address()}`);
});
