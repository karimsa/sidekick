import type { StreamingRpcHandler } from '../utils/http';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuid } from 'uuid';
import jsonStableStringify from 'json-stable-stringify';
import isEqual from 'lodash/isEqual';

const socket = io(`http://${global.location?.hostname}:9010/`, {
	autoConnect: !!global.window,
});

type StreamingRpcAction<Data> =
	| { type: 'open' }
	| { type: 'data'; data: Data }
	| { type: 'error'; error: string }
	| { type: 'end' };

// TODO: Limit retries, auto retry on network change

export function useStreamingRpcQuery<InputType, OutputType, State>(
	// this is the type of the handler at compile-time
	rpcHandler: StreamingRpcHandler<InputType, OutputType>,
	data: InputType,
	reducer: (state: State, action: StreamingRpcAction<OutputType>) => State,
	initialState: State,
) {
	// this is the type of the handler at runtime
	const { methodName } = rpcHandler as unknown as { methodName: string };
	const reducerWrapper = useCallback(
		(state: State, action: StreamingRpcAction<OutputType>) => {
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
	const [isStreaming, setIsStreaming] = useState(true);

	const dataKey = useMemo(() => jsonStableStringify(data), [data]);

	useEffect(
		() => {
			function onStreamError({
				requestId: incomingRequestId,
				error,
			}: {
				requestId: string;
				error: string;
			}) {
				if (incomingRequestId === requestId) {
					dispatch({ type: 'error', error });
					setIsStreaming(false);
					setTimeout(() => setRequestId(uuid()), 1e3);
				}
			}

			function onStreamData({
				requestId: incomingRequestId,
				data,
			}: {
				requestId: string;
				data: OutputType;
			}) {
				if (incomingRequestId === requestId) {
					dispatch({ type: 'data', data });
				}
			}

			function onStreamEnd({
				requestId: incomingRequestId,
			}: {
				requestId: string;
			}) {
				if (incomingRequestId === requestId) {
					dispatch({ type: 'end' });
				}
			}

			function openStream() {
				dispatch({ type: 'open' });
				socket.emit('openStream', {
					methodName,
					params: data,
					requestId,
				});
			}

			function onConnect() {
				openStream();
			}

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
				});

				socket.off('streamError', onStreamError);
				socket.off('streamData', onStreamData);
				socket.off('streamEnd', onStreamEnd);
				socket.off('connect', onConnect);
			};
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[dataKey, methodName, requestId],
	);

	return { data: state, isStreaming };
}
