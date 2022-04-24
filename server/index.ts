import express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http';
import cors from 'cors';
import { Server as SocketServer, Socket } from 'socket.io';
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
import {
	getExtensionClient,
	getExtensions,
	runExtensionMethod,
} from './controllers/extensions';
import {
	bulkServiceAction,
	getBulkServerHealth,
	getServerHealth,
	getService,
	getServiceLogs,
	getServiceProcessInfo,
	getServices,
	getServiceScripts,
	getZombieProcessInfo,
	killProcesses,
	prepareService,
	prepareStaleServices,
	restartDevServer,
	runServiceScript,
	startService,
	stopService,
} from './controllers/servers';
import { getHeartbeat } from './controllers/heartbeat';
import { z } from 'zod';

const app = express();

const methods: Record<string, RpcHandler<any, any>> = {
	getConfig,
	updateConfig,

	getExtensions,
	getExtensionClient,
	runExtensionMethod,

	getZombieProcessInfo,

	killProcesses,
	getServices,
	startService,
	stopService,
	getService,
	getServiceProcessInfo,
	restartDevServer,
	bulkServiceAction,
	getServiceScripts,
};

const streamingMethods: Record<string, StreamingRpcHandler<any, any>> = {
	getHeartbeat,
	getBulkServerHealth,
	getServerHealth,
	getServiceLogs,
	runServiceScript,
	prepareService,
	prepareStaleServices,
};

const corsConfig = { origin: ['http://localhost:9001'] };

app.use(cors(corsConfig));
app.options('/api/rpc/:methodName', (req, res) => {
	res.end();
});
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
	process.chdir(__dirname);

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

const io = new SocketServer(server, {
	cors: corsConfig,
});

function sendError(
	socket: Socket,
	methodName: string,
	requestId: string,
	error: any,
) {
	console.error(`Socket stream encountered an error: ${error.stack || error}`);
	socket.emit('streamError', { requestId, methodName, error: String(error) });
}

io.on('connection', (socket) => {
	socket.on('openStream', async (data) => {
		try {
			const { methodName, requestId, params } = validate(
				z.object({
					methodName: z.string(),
					params: z.unknown(),
					requestId: z.string(),
				}),
				data,
			);

			try {
				const method = streamingMethods[methodName];
				if (!method) {
					throw new Error(`Unrecognized method name: ${methodName}`);
				}

				const observable = method(params);
				const subscription = observable.subscribe({
					next: (data) =>
						socket.emit('streamData', {
							methodName,
							requestId,
							data,
						}),
					error: (err) => sendError(socket, methodName, requestId, err),
					complete: () => socket.emit('streamEnd', { requestId, methodName }),
				});

				socket.on('disconnect', () => {
					subscription.unsubscribe();
				});
				socket.on('closeStream', ({ requestId: incomingRequestId }) => {
					if (incomingRequestId === requestId) {
						subscription.unsubscribe();
					}
				});
			} catch (error) {
				sendError(socket, methodName, requestId, error);
			}
		} catch (error) {
			sendError(socket, '(unknown)', '', error);
		}
	});
});

server.listen(process.env.SIDEKICK_PORT || 9010, () => {
	console.log(fmt`Sidekick server listening on :${server.address()}`);
});
