import express from 'express';
import { AbortController } from 'node-abort-controller';
import { z } from 'zod';

import { fmt } from './fmt';

export type ApiRequest<ReqBodyType = never> = express.Request & {
	body: ReqBodyType;
};

export type RouteHandler<ReqBodyType, ResBodyType> = (
	request: ApiRequest<ReqBodyType>,
	response: express.Response,
) => Promise<ResBodyType>;

export const HTTPStatus = {
	BadRequest: 400,
	Unauthorized: 401,
	PaymentRequired: 402,
	Forbidden: 403,
	NotFound: 404,
	TooManyRequests: 429,
};

export class APIError extends Error {
	constructor(
		message: string,
		readonly status = 500,
		readonly displayMessage?: string,
		readonly meta: any = {},
	) {
		super(message);
	}
}

export function writeError(error: Partial<APIError>, res: express.Response) {
	const status = error.status || 500;
	console.error(fmt`Request failed with status code ${error.status}`, error);

	res.status(status);
	res.json({
		...(error.meta || {}),
		error: String(
			error.displayMessage ||
				error.message ||
				'The application is currently unavailable. Please try again later.',
		),
		displayMessage: Boolean(error.displayMessage),
	});
}

export const NO_RESPONSE = Symbol('NO_RESPONSE');

export function route<ReqBodyType, ResBodyType>(
	handler: RouteHandler<ReqBodyType, ResBodyType>,
): RouteHandler<ReqBodyType, void> {
	return async (req, res) => {
		try {
			const body = (await handler(req, res)) as any;
			if (body === NO_RESPONSE) {
				res.status(204);
				res.end();
			} else {
				if (typeof body === 'object' && body !== null) {
					res.json(body);
				} else if (typeof body === 'string') {
					if (!res.hasHeader('Content-Type')) {
						res.setHeader('Content-Type', 'text/plain');
					}
					res.end(body);
				} else {
					throw new Error(`Route did not return a valid body`);
				}
			}
		} catch (error: any) {
			writeError(error, res);
		}
	};
}

export function validate<T>(dataType: z.Schema<T>, data: any) {
	const result = dataType.safeParse(data);
	if (!result.success) {
		const error = new APIError(
			result.error.message,
			HTTPStatus.BadRequest,
			result.error.message,
		);
		Error.captureStackTrace(error, validate);
		throw error;
	}
	return result.data;
}

export type RpcHandler<InputType, OutputType> = RouteHandler<
	InputType,
	OutputType
> & {
	run(data: InputType): Promise<OutputType>;
	__inputType: InputType;
	__outputType: OutputType;
};

export type StreamingRpcHandler<InputType, OutputType> = ((
	data: InputType,
	abortController: AbortController,
) => AsyncGenerator<OutputType, void, unknown>) & {
	__streaming: true;
	__inputType: InputType;
	__outputType: OutputType;
};

export type RpcInputType<Handler> = Handler extends RpcHandler<
	infer InputType,
	any
>
	? InputType
	: Handler extends StreamingRpcHandler<infer StreamingInputType, any>
	? StreamingInputType
	: never;
export type RpcOutputType<Handler> = Handler extends RpcHandler<
	any,
	infer OutputType
>
	? OutputType
	: Handler extends StreamingRpcHandler<any, infer StreamingOutputType>
	? StreamingOutputType
	: never;

export function createRpcMethod<InputType, ReturnType>(
	inputType: z.Schema<InputType>,
	handler: (
		data: InputType,
		req?: ApiRequest<InputType>,
		res?: express.Response,
	) => Promise<ReturnType>,
): RpcHandler<InputType, ReturnType> {
	const wrapper: RouteHandler<{ data: unknown }, ReturnType> = async (
		req,
		res,
	) => {
		const data = validate(inputType, req.body);
		return handler(
			data,
			Object.assign(req, {
				body: data,
			}),
			res,
		);
	};
	return Object.assign(wrapper as any, {
		run(data: InputType) {
			return handler(validate(inputType, data));
		},
	});
}

export function createStreamingRpcMethod<InputType, OutputType>(
	inputType: z.Schema<InputType>,
	handler: (
		data: InputType,
		abortController: AbortController,
	) => AsyncGenerator<OutputType, void, unknown>,
): StreamingRpcHandler<InputType, OutputType> {
	const wrapper = async function* (
		rawInput: unknown,
		abortController: AbortController,
	) {
		const validatedInput = validate(inputType, rawInput);
		yield* handler(validatedInput, abortController);
	};
	return wrapper as any;
}
