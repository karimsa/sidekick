import { fmt } from './fmt';
import { z } from 'zod';

export function parseJson<Data>(dataType: z.Schema<Data>, str: string): Data {
	try {
		return dataType.parse(JSON.parse(str));
	} catch (error: any) {
		throw new Error(
			fmt`Failed to parse json: ${error.message ?? error}\n${str}`,
		);
	}
}
