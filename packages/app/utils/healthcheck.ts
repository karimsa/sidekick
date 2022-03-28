import axios from 'axios';
import net from 'net';

export async function testHttp(port: number): Promise<boolean> {
	// tslint:disable-next-line
	try {
		await axios.get(`http://localhost:${port}`, {
			timeout: 1000,
		});
		return true;
	} catch (error: any) {
		return typeof error.response?.status === 'number';
	}
}

export function testTcp(port: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const client = net.connect(port, 'localhost');
		client.on('connect', () => {
			client.end();
			resolve(true);
		});
		client.on('error', () => resolve(false));
	});
}
