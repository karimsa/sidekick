import type { StreamingRpcHandler } from '../utils/http';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuid } from 'uuid';

const socket = io(`http://${location.hostname}:9002/`, {
    autoConnect: !!global.window
});

function useStreamingRpcQueryInternal<InputType, OutputType>(
    // this is the type of the handler at runtime
    handler: { methodName: string },
    data: InputType,
    options: { onResult(result: OutputType): void; onEnd?: () => void }
) {
    const requestIdRef = useRef(uuid());

    const onResultRef = useRef(options.onResult);
    onResultRef.current = options.onResult;

    const onEndRef = useRef(options.onEnd);
    onEndRef.current = options.onEnd;

    const [isStreaming, setIsStreaming] = useState(true);
    const [error, setError] = useState<Error | undefined>();

    useEffect(() => {
        socket.on('streamError', ({ requestId, error }) => {
            if (requestId === requestIdRef.current) {
                setError(error);
                setIsStreaming(false);
            }
        });
        socket.on('streamData', ({ requestId, data }) => {
            if (requestId === requestIdRef.current) {
                onResultRef.current(data);
            }
        });
        socket.on('streamEnd', ({ requestId }) => {
            if (requestId === requestIdRef.current) {
                onEndRef.current();
            }
        });

        if (socket.connected) {
            socket.emit('openStream', {
                methodName: handler.methodName,
                params: data,
                requestId: requestIdRef.current
            });
        }
        socket.on('connect', () => {
            socket.emit('openStream', {
                methodName: handler.methodName,
                params: data,
                requestId: requestIdRef.current
            });
        });

        return () => {
            socket.emit('closeStream', {
                requestId: requestIdRef.current
            });
            requestIdRef.current = uuid();
        };
    }, [data, handler.methodName]);

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
