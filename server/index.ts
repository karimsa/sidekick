import express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http';
import cors from 'cors';
import { Server as SocketServer, Socket } from 'socket.io';
import * as t from 'io-ts';
import { AbortController } from 'node-abort-controller';
import morgan from 'morgan';
import next from 'next';

import { fmt } from '../utils/fmt';
import {
	APIError,
	route,
	RpcHandler,
	StreamingRpcHandler,
	validate,
} from '../utils/http';
import { getConfig, updateConfig } from './controllers/config';
import { getExtensions, runExtensionMethod } from './controllers/extensions';
import {
	getServerHealth,
	getServers,
	getService,
	getServiceLogs,
	getServiceProcessInfo,
	getServices,
	getServiceTags,
	getZombieProcessInfo,
	restartDevServer,
	startService,
	stopService,
} from './controllers/servers';
import { getHeartbeat } from './controllers/heartbeat';

const app = express();

const methods: Record<string, RpcHandler<any, any>> = {
	getConfig,
	updateConfig,

	getExtensions,
	runExtensionMethod,

	getZombieProcessInfo,

	getServers,
	getServices,
	getServiceTags,
	startService,
	stopService,
	getService,
	getServiceProcessInfo,
	restartDevServer,
};

const streamingMethods: Record<string, StreamingRpcHandler<any, any>> = {
	getHeartbeat,
	getServerHealth,
	getServiceLogs,
};

const corsConfig = { origin: ['http://localhost:9001'] };

app.use(cors(corsConfig));
app.post(
	'/api/rpc/:methodName',
	bodyParser.json({ limit: 1024 * 1024 }),
	route(async (req, res) => {
		const { methodName } = req.params;
		const method = methods[String(methodName)];
		if (!method) {
			throw new APIError(`Unrecognized method name: ${methodName}`);
		}
		return method(req, res);
	}),
);

if (process.env.NODE_ENV === 'production') {
	app.use(morgan('dev'));
	const nextApp = next({});
	const nextHandler = nextApp.getRequestHandler();
	app.use((req, res) => {
		nextHandler(req, res).catch((error) => {
			res.status(500);
			res.json({ error: String(error) });
		});
	});
}

const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === 'production';

const io = new SocketServer(server, {
	cors: corsConfig,
});

function sendError(socket: Socket, requestId: string, error: any) {
	console.error(`Socket stream encountered an error: ${error.stack || error}`);
	socket.emit('streamError', { requestId, error: String(error) });
}
function sendResult(
	socket: Socket,
	methodName: string,
	requestId: string,
	data: any,
) {
	if (isProduction) {
		socket.emit('streamData', { requestId, data });
	} else {
		socket.emit('streamData', {
			methodName,
			requestId,
			data,
		});
	}
}

io.on('connection', (socket) => {
	socket.on('openStream', async (data) => {
		try {
			const { methodName, requestId, params } = validate(
				t.interface({
					methodName: t.string,
					params: t.unknown,
					requestId: t.string,
				}),
				data,
			);

			const abortController = new AbortController();
			try {
				const method = streamingMethods[methodName];
				if (!method) {
					throw new Error(`Unrecognized method name: ${methodName}`);
				}

				socket.on('disconnect', () => {
					abortController.abort();
				});
				socket.on('closeStream', ({ requestId: incomingRequestId }) => {
					if (incomingRequestId === requestId) {
						abortController.abort();
					}
				});

				for await (const result of method(params, abortController)) {
					sendResult(socket, methodName, requestId, result);
				}

				socket.emit('streamEnd', {
					requestId,
				});
			} catch (error) {
				sendError(socket, requestId, error);
				abortController.abort();
			}
		} catch (error) {
			sendError(socket, '', error);
		}
	});
});

server.listen(process.env.PORT || 9002, () => {
	console.log(fmt`Sidekick server listening on :${server.address()}`);
});
