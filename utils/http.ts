import * as t from 'io-ts';
import type { NextApiRequest, NextApiResponse } from 'next';
import { PathReporter } from 'io-ts/lib/PathReporter';

import { fmt } from './fmt';

export type ApiRequest<ReqBodyType = never> = NextApiRequest & {
    body: ReqBodyType;
};

export type RouteHandler<ReqBodyType, ResBodyType> = (
    request: ApiRequest<ReqBodyType>,
    response: NextApiResponse
) => Promise<ResBodyType>;

export const HTTPStatus = {
    BadRequest: 400,
    Unauthorized: 401,
    PaymentRequired: 402,
    Forbidden: 403,
    NotFound: 404,
    TooManyRequests: 429
};

export class APIError extends Error {
    constructor(message: string, readonly status = 500, readonly displayMessage?: string, readonly meta: any = {}) {
        super(message);
    }
}

export function writeError(error: Partial<APIError>, res: NextApiResponse) {
    const status = error.status || 500;
    console.error(fmt`Request failed with status code ${error.status}`, error);

    res.status(status);
    res.json({
        ...(error.meta || {}),
        error: String(
            error.displayMessage || error.message || 'The application is currently unavailable. Please try again later.'
        ),
        displayMessage: Boolean(error.displayMessage)
    });
}

export const NO_RESPONSE = Symbol('NO_RESPONSE');

export function route<ReqBodyType, ResBodyType>(
    handler: RouteHandler<ReqBodyType, ResBodyType>
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

export const qsNumber = new t.Type(
    'querystringNumber',
    (i): i is Number => typeof i === 'string' && !isNaN(Number(i)),
    (i, ctx) => (typeof i === 'string' && !isNaN(Number(i)) ? t.success(Number(i)) : t.failure(i, ctx)),
    Number
);

const BooleanString = (val: any) => val === 'true';
export const qsBoolean = new t.Type(
    'querystringBoolean',
    (i): i is boolean => i === 'true' || i === 'false',
    (i, ctx) => (i === 'true' || i === 'false' ? t.success(BooleanString(i)) : t.failure(i, ctx)),
    BooleanString
);

export function validate<T>(dataType: t.Type<T>, data: any) {
    const result = dataType.decode(data);
    if (result._tag === 'Left') {
        const errors = PathReporter.report(result);
        const error = new APIError(errors[0], HTTPStatus.BadRequest, errors[0]);
        Error.captureStackTrace(error, validate);
        throw error;
    }
    return result.right;
}

export type RpcHandler<InputType, OutputType> = RouteHandler<InputType, OutputType> & {
    __inputType: InputType;
    __outputType: OutputType;
};

export type RpcInputType<Handler> = Handler extends RpcHandler<infer InputType, any> ? InputType : never;
export type RpcOutputType<Handler> = Handler extends RpcHandler<any, infer OutputType> ? OutputType : never;

export function createRpcMethod<InputType, ReturnType>(
    inputType: t.Type<InputType>,
    handler: (data: InputType, req: ApiRequest<InputType>, res: NextApiResponse) => Promise<ReturnType>
): RpcHandler<InputType, ReturnType> {
    const wrapper: RouteHandler<{ data: unknown }, ReturnType> = async (req, res) => {
        const data = validate(inputType, req.body.data);
        return handler(
            data,
            Object.assign(req, {
                body: data
            }),
            res
        );
    };
    return wrapper as any;
}
