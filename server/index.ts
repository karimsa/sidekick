import * as bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import proxy from 'express-http-proxy';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { Server as SocketServer, Socket } from 'socket.io';

import { z } from 'zod';
import { getConfig, getVersion, updateConfig } from './controllers/config';
import { getExtensions, runExtensionMethod } from './controllers/extensions';
import { getHeartbeat } from './controllers/heartbeat';
import {
	bulkServiceAction,
	getBulkServerHealth,
	getService,
	getServiceLogs,
	getServiceProcessInfo,
	getServices,
	getServiceScripts,
	getZombieProcessInfo,
	killProcesses,
	pauseDevServer,
	pauseService,
	prepareService,
	prepareStaleServices,
	restartDevServer,
	resumeDevServer,
	resumeService,
	runServiceScript,
	startService,
	stopService,
} from './controllers/servers';
import {
	checkForSidekickUpdates,
	setSidekickChannel,
	upgradeSidekick,
} from './controllers/upgrade';
import { setupExtensionEndpoints } from './utils/extensions';
import { fmt } from './utils/fmt';
import {
	APIError,
	route,
	RpcHandler,
	StreamingRpcHandler,
	validate,
} from './utils/http';
import { IS_DEVELOPMENT } from './utils/is-development';
import { dispatchTasks } from './utils/TaskRunner';

const app = express();

const serverPort = process.env.SIDEKICK_PORT
	? Number(process.env.SIDEKICK_PORT)
	: 9010;
const bindAddr = process.env.SIDEKICK_BIND_ADDR || '::1';

export const rpcMethods: Record<string, RpcHandler<any, any>> = {
	getConfig,
	getVersion,
	updateConfig,

	getExtensions,
	runExtensionMethod,

	getZombieProcessInfo,

	killProcesses,
	getServices,
	startService,
	stopService,
	pauseService,
	pauseDevServer,
	resumeDevServer,
	resumeService,
	getService,
	getServiceProcessInfo,
	restartDevServer,
	bulkServiceAction,
	getServiceScripts,

	checkForSidekickUpdates,
	upgradeSidekick,
	setSidekickChannel,
};

const streamingMethods: Record<string, StreamingRpcHandler<any, any>> = {
	getHeartbeat,
	getBulkServerHealth,
	getServiceLogs,
	runServiceScript,
	prepareService,
	prepareStaleServices,
};

const corsConfig = {
	origin: IS_DEVELOPMENT
		? true
		: [
				`http://localhost:${serverPort}`,
				`http://127.0.0.1:${serverPort}`,
				`http://sidekick.local:${serverPort}`,
				`http://[::1]:${serverPort}`,
		  ],
};

app.use(cors(corsConfig));
app.options('/api/rpc/:methodName', (req, res) => {
	res.end();
});
app.post(
	'/api/rpc/:methodName',
	bodyParser.json({ limit: 1024 * 1024 }),
	route(async (req, res) => {
		const { methodName } = req.params;
		const method = rpcMethods[String(methodName)];
		if (!method) {
			throw new APIError(`Unrecognized method name: ${methodName}`);
		}
		return method(req, res);
	}),
);
setupExtensionEndpoints(app);

if (IS_DEVELOPMENT) {
	app.use(proxy('http://localhost:9001', {}));
} else {
	const setupRoutes = (cwd: string, rootDir: string) => {
		for (const filename of fs.readdirSync(path.join(rootDir, cwd))) {
			if (fs.statSync(path.join(rootDir, cwd, filename)).isDirectory()) {
				setupRoutes(path.join(cwd, filename), rootDir);
			} else if (filename.endsWith('.html')) {
				const route =
					'/' +
					path
						.join(cwd, filename)
						.replace(/\[(\w+)\]/g, ':$1')
						.replace(/\.html$/, '');
				const content = fs.readFileSync(
					path.join(rootDir, cwd, filename),
					'utf8',
				);

				app.get(route, (_, res) => {
					res.contentType('html');
					res.send(content);
				});
			}
		}
	};
	setupRoutes('./', path.resolve(__dirname, 'out'));

	app.use(express.static(path.resolve(__dirname, 'out')));
	app.use((req, res) => {
		res.sendFile(path.resolve(__dirname, 'out/404.html'));
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

server.listen(serverPort, bindAddr, () => {
	console.log(
		fmt`Sidekick server listening on ${server.address()} (pid ${process.pid})`,
	);
	dispatchTasks();
});
