import type { StreamingRpcHandler } from '../server/utils/http';
import { Dispatch, useCallback, useEffect, useReducer, useState } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuid } from 'uuid';
import jsonStableStringify from 'json-stable-stringify';
import isEqual from 'lodash/isEqual';

const socket = io(`http://${global.location?.hostname}:9010/`, {
	autoConnect: !!global.window,
});

export type StreamingRpcAction<Data, CustomAction> =
	| { type: 'open' }
	| { type: 'data'; data: Data }
	| { type: 'error'; error: string }
	| { type: 'end' }
	| CustomAction;

export interface StreamOptions {
	autoRetry?: boolean;
}

// TODO: Limit retries, auto retry on network change

export function useStreamingRpcQuery<
	InputType,
	OutputType,
	State,
	CustomAction = never,
>(
	// this is the type of the handler at compile-time
	rpcHandler: StreamingRpcHandler<InputType, OutputType>,
	data: InputType,
	reducer: (
		state: State,
		action: StreamingRpcAction<OutputType, CustomAction>,
	) => State,
	initialState: State,
	options?: StreamOptions,
) {
	const { mutate, ...result } = useLazyStreamingRpcQuery(
		rpcHandler,
		reducer,
		initialState,
		options,
	);
	useEffect(() => {
		mutate(data, jsonStableStringify(data));
	}, [data, mutate]);
	return result;
}

export function useLazyStreamingRpcQuery<
	InputType,
	OutputType,
	State,
	CustomAction = never,
>(
	rpcHandler: StreamingRpcHandler<InputType, OutputType>,
	reducer: (
		state: State,
		action: StreamingRpcAction<OutputType, CustomAction>,
	) => State,
	initialState: State,
	options: StreamOptions = { autoRetry: true },
) {
	const { methodName } = rpcHandler as unknown as { methodName: string };
	const reducerWrapper = useCallback(
		(state: State, action: StreamingRpcAction<OutputType, CustomAction>) => {
			const nextState = reducer(state, action);
			if (isEqual(nextState, state)) {
				return state;
			}
			return nextState;
		},
		[reducer],
	);
	const [state, dispatch] = useReducer(reducerWrapper, initialState);

	const [requestId, setRequestId] = useState(() => uuid());
	const [isStreaming, setIsStreaming] = useState(false);

	const [data, setData] = useState<{ payload: any; key: string } | null>(null);

	useEffect(
		() => {
			if (!data) {
				return;
			}

			const onStreamError = ({
				requestId: incomingRequestId,
				error,
			}: {
				requestId: string;
				error: string;
			}) => {
				if (incomingRequestId === requestId) {
					dispatch({ type: 'error', error });
					setIsStreaming(false);

					if (options?.autoRetry) {
						setTimeout(() => setRequestId(uuid()), 1e3);
					}
				}
			};

			const onStreamData = ({
				requestId: incomingRequestId,
				data,
			}: {
				requestId: string;
				data: OutputType;
			}) => {
				if (incomingRequestId === requestId) {
					dispatch({ type: 'data', data });
				}
			};

			const onStreamEnd = ({
				requestId: incomingRequestId,
			}: {
				requestId: string;
			}) => {
				if (incomingRequestId === requestId) {
					setIsStreaming(false);
					dispatch({ type: 'end' });
				}
			};

			const openStream = () => {
				setIsStreaming(true);
				dispatch({ type: 'open' });
				socket.emit('openStream', {
					methodName,
					params: data.payload,
					requestId,
				});
			};

			const onConnect = () => {
				if (options?.autoRetry) {
					openStream();
				}
			};

			socket.on('streamError', onStreamError);
			socket.on('streamData', onStreamData);
			socket.on('streamEnd', onStreamEnd);
			socket.on('connect', onConnect);

			if (socket.connected) {
				openStream();
			}

			return () => {
				socket.emit('closeStream', {
					requestId,
					methodName,
				});

				socket.off('streamError', onStreamError);
				socket.off('streamData', onStreamData);
				socket.off('streamEnd', onStreamEnd);
				socket.off('connect', onConnect);
			};
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[data?.key, methodName, requestId],
	);

	return {
		data: state,
		isStreaming,
		mutate: useCallback((data: InputType, key?: string) => {
			setData({ payload: data, key: key ?? uuid() });
		}, []),
		dispatch: dispatch as Dispatch<CustomAction>,
	};
}
