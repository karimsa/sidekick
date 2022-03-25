import express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http';
import cors from 'cors';
import { Server as SocketServer, Socket } from 'socket.io';
import * as t from 'io-ts';
import { AbortController } from 'node-abort-controller';

import { fmt } from '../utils/fmt';
import { APIError, route, RpcHandler, StreamingRpcHandler, validate } from '../utils/http';
import { getConfig, updateConfig } from './controllers/config';
import { getExtensions, runExtensionMethod } from './controllers/extensions';
import { getServerHealth, getServers, getZombieProcessInfo, startService } from './controllers/servers';
import { getHeartbeat } from './controllers/heartbeat';

const app = express();

const methods: Record<string, RpcHandler<any, any>> = {
    getConfig,
    updateConfig,

    getExtensions,
    runExtensionMethod,

    getServers,
    getZombieProcessInfo,
    startService
};

const streamingMethods: Record<string, StreamingRpcHandler<any, any>> = {
    getHeartbeat,
    getServerHealth
};

const corsConfig = { origin: ['http://localhost:9001'] };

app.use(bodyParser.json({ limit: 1024 }));
app.use(cors(corsConfig));
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

const io = new SocketServer(server, {
    cors: corsConfig
});

function sendError(socket: Socket, requestId: string, error: any) {
    console.error(`Socket stream encountered an error: ${error.stack || error}`);
    process.exit(1);
    socket.emit('streamError', { requestId, error: String(error) });
}
function sendResult(socket: Socket, requestId: string, data: any) {
    socket.emit('streamData', { requestId, data });
}

io.on('connection', socket => {
    socket.on('openStream', async data => {
        try {
            const { methodName, requestId, params } = validate(
                t.interface({
                    methodName: t.string,
                    params: t.unknown,
                    requestId: t.string
                }),
                data
            );

            try {
                const method = streamingMethods[methodName];
                if (!method) {
                    throw new Error(`Unrecognized method name: ${methodName}`);
                }

                const abortController = new AbortController();
                socket.on('disconnect', () => {
                    abortController.abort();
                });
                socket.on('closeStream', ({ requestId: incomingRequestId }) => {
                    if (incomingRequestId === requestId) {
                        abortController.abort();
                    }
                });

                for await (const result of method(params, abortController)) {
                    sendResult(socket, requestId, result);
                }

                socket.emit('streamEnd', {
                    requestId
                });
            } catch (error) {
                sendError(socket, requestId, error);
            }
        } catch (error) {
            sendError(socket, '', error);
        }
    });
});

server.listen(process.env.PORT || 9002, () => {
    console.log(fmt`Sidekick server listening on :${server.address()}`);
});
