import { describe, expect, it, afterEach } from '@jest/globals';
import * as http from 'http';
import { testHealthCheck } from '../healthcheck';
import { TestCleanup } from '../../cli/__tests__/test-utils';

const startServer = (hostname: string) =>
	new Promise<{ port: number; close(): void }>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			res.end('hello world');
		});
		server.listen(0, hostname, () => {
			console.dir(server.address());
			resolve({
				port: (server.address() as any)?.port,
				close: () => server.close(),
			});
		});
		server.on('error', reject);
	});
const nodeVersion = Number(process.version.split(/[v\.]+/g)[1]);

describe('Health Checks', () => {
	const cleanup = new TestCleanup();

	afterEach(cleanup.afterEachHook);

	it('should be able to perform TCP checks', async () => {
		const { port, close } = await startServer('127.0.0.1');
		cleanup.push(close);

		// IPv4 check should succeed
		expect(
			await testHealthCheck('test', { type: 'tcp', port, ipv4: true }),
		).toEqual(true);
		// IPv6 check should fail
		expect(
			await testHealthCheck('test', { type: 'tcp', port, ipv4: false }),
		).toEqual(false);
		// Default should be IPv6 if not specified
		expect(await testHealthCheck('test', { type: 'tcp', port })).toEqual(false);
	});
	it('should be able to perform legacy HTTP checks', async () => {
		const { port, close } = await startServer('127.0.0.1');
		cleanup.push(close);

		// HTTP check on the port should succeed
		expect(await testHealthCheck('test', { type: 'http', port })).toEqual(true);
	});
	it('should fail legacy HTTP checks on IPv6', async () => {
		const { port, close } = await startServer('::1');
		cleanup.push(close);

		// HTTP check on the port should fail
		expect(await testHealthCheck('test', { type: 'http', port })).toEqual(
			false,
		);
	});
	it('should perform new HTTP checks on IPv4', async () => {
		const { port, close } = await startServer('127.0.0.1');
		cleanup.push(close);

		// HTTP check on the port should succeed
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'GET',
				url: `http://127.0.0.1:${port}/`,
			}),
		).toEqual(true);
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'HEAD',
				url: `http://127.0.0.1:${port}/`,
			}),
		).toEqual(true);
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'OPTIONS',
				url: `http://127.0.0.1:${port}/`,
			}),
		).toEqual(true);
	});
	it('should perform new HTTP checks on IPv6', async () => {
		if (nodeVersion < 17) {
			// Node 16 and below don't support IPv6
			return;
		}

		const { port, close } = await startServer('::1');
		cleanup.push(close);

		// HTTP check on the port should succeed
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'GET',
				url: `http://127.0.0.1:${port}/`,
			}),
		).toEqual(false);
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'GET',
				url: `http://::1:${port}/`,
			}),
		).toEqual(true);
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'HEAD',
				url: `http://::1:${port}/`,
			}),
		).toEqual(true);
		expect(
			await testHealthCheck('test', {
				type: 'http',
				method: 'OPTIONS',
				url: `http://::1:${port}/`,
			}),
		).toEqual(true);
	});
});
