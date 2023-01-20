import axios from 'axios';
import * as net from 'net';
import { Logger } from '../services/logger';
import { assertUnreachable } from './util-types';

const logger = new Logger('health');

export async function testHttp({
	method,
	url,
}: {
	method: 'GET' | 'HEAD' | 'OPTIONS';
	url: string;
}): Promise<boolean> {
	// tslint:disable-next-line
	try {
		await axios({
			url,
			method,
			timeout: 1000,
		});
		return true;
	} catch (error: any) {
		return typeof error.response?.status === 'number';
	}
}

export function testTcp({
	port,
	ipv4,
}: {
	port: number;
	ipv4?: boolean;
}): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const client = net.connect(port, ipv4 ? '127.0.0.1' : '::1');
		client.on('connect', () => {
			client.end();
			resolve(true);
		});
		client.on('error', () => resolve(false));
	});
}

export type ServiceConfigHealthCheckOptions =
	| { type: 'tcp'; port: number; ipv4?: boolean; url?: undefined }
	| { type: 'http'; port: number; url?: undefined }
	| {
			type: 'http';
			port?: undefined;
			method: 'GET' | 'HEAD' | 'OPTIONS';
			url: string;
	  };

export function testHealthCheck(
	serviceName: string,
	options: ServiceConfigHealthCheckOptions,
) {
	if (options.type === 'tcp') {
		return testTcp(options);
	}
	if (options.port !== undefined) {
		logger.warn(
			`Service ${serviceName} is configured to use legacy option of port number`,
			{
				serviceName,
				options: options,
			},
		);
		return testHttp({
			method: 'GET',
			url: `http://127.0.0.1:${options.port}`,
		});
	}
	if (options.type === 'http') {
		return testHttp(options);
	}

	assertUnreachable(options);
	throw new Error(
		`Unrecognized health check options: ${JSON.stringify(options)}`,
	);
}
