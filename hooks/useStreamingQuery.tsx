import type { StreamingRpcHandler } from '../utils/http';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuid } from 'uuid';
import jsonStableStringify from 'json-stable-stringify';

const socket = io(`http://${global.location?.hostname}:9002/`, {
    autoConnect: !!global.window
});

function useStreamingRpcQueryInternal<InputType, OutputType>(
    // this is the type of the handler at runtime
    handler: { methodName: string },
    data: InputType,
    options: { onResult(result: OutputType): void; onEnd?: () => void; autoRestart?: boolean }
) {
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [requestId, setRequestId] = useState(() => uuid());
    const [isStreaming, setIsStreaming] = useState(true);
    const [error, setError] = useState<Error | undefined>();

    const dataKey = useMemo(() => jsonStableStringify(data), [data]);

    useEffect(
        () => {
            function onStreamError({ requestId: incomingRequestId, error }) {
                if (incomingRequestId === requestId) {
                    setError(error);
                    setIsStreaming(false);

                    if (optionsRef.current.autoRestart) {
                        setRequestId(uuid());
                    }
                }
            }

            function onStreamData({ requestId: incomingRequestId, data }) {
                if (incomingRequestId === requestId) {
                    optionsRef.current.onResult(data);
                }
            }

            function onStreamEnd({ requestId: incomingRequestId }) {
                if (incomingRequestId === requestId) {
                    optionsRef.current.onEnd?.();
                }
            }

            function openStream() {
                socket.emit('openStream', {
                    methodName: handler.methodName,
                    params: data,
                    requestId
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
                    requestId
                });

                socket.off('streamError', onStreamError);
                socket.off('streamData', onStreamData);
                socket.off('streamEnd', onStreamEnd);
                socket.off('connect', onConnect);
            };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [dataKey, handler.methodName, requestId]
    );

    return { error, isStreaming };
}

export function useStreamingRpcQuery<InputType, OutputType>(
    // this is the type of the handler at compile-time
    handler: StreamingRpcHandler<InputType, OutputType>,
    data: InputType,
    options: { onResult(result: OutputType): void; onEnd?: () => void }
) {
    return useStreamingRpcQueryInternal(handler as any, data, options);
}
