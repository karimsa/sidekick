import { StreamingRpcAction, useStreamingRpcQuery } from './useStreamingQuery';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '../components/Button';
import { Modal, ModalBody, ModalTitle } from '../components/Modal';
import { Monaco } from '../components/Monaco';
import { Spinner } from '../components/Spinner';
import { AlertFillIcon, CheckCircleFillIcon } from '@primer/octicons-react';
import constate from 'constate';
import { StreamingRpcHandler } from '../server/utils/http';

type LogState = { isComplete: boolean; isFailed: boolean; output: string };
type LogAction = StreamingRpcAction<string, never>;

export const reduceStreamingLogs = [
	(state: LogState, action: LogAction): LogState => {
		switch (action.type) {
			case 'open':
				return { isComplete: false, isFailed: false, output: '' };
			case 'data':
				return { ...state, output: state.output + action.data };
			case 'error':
				return {
					...state,
					isFailed: true,
					output: `${state.output}\n\nFailed to run: ${action.error}`,
				};
			case 'end':
				return {
					...state,
					isComplete: true,
					output: `${state.output}\n\nSuccessfully completed.`,
				};
		}
	},
	{ isComplete: false, isFailed: false, output: '' },
	{ autoRetry: false },
] as const;

interface LogWindowRemoteCall<T> {
	id: string;
	title: string;
	successToast: string;
	errorToast: string;
	loadingToast: string;
	method: StreamingRpcHandler<T, string>;
	data: T;
}

const [LogWindowManagerProvider, useLogWindowManagerState] = constate(() => {
	const [remoteCalls, setRemoteCalls] = useState<LogWindowRemoteCall<any>[]>(
		[],
	);
	return { remoteCalls, setRemoteCalls };
});

export function useLogWindow<T>(
	id: string,
	method: StreamingRpcHandler<T, string>,
) {
	const { remoteCalls, setRemoteCalls } = useLogWindowManagerState();
	return {
		mutate: useCallback(
			function dispatchRemoteCall<T>(
				remoteCall: Omit<LogWindowRemoteCall<T>, 'method' | 'id'>,
			) {
				setRemoteCalls((remoteCalls) => [
					...remoteCalls.filter((rc) => rc.id !== id),
					{ ...remoteCall, method, id },
				]);
			},
			[id, method, setRemoteCalls],
		),
		isRunning: useMemo(
			() => remoteCalls.some((rc) => rc.id === id),
			[id, remoteCalls],
		),
	};
}

const LogWindowController: React.FC<
	LogWindowRemoteCall<any> & { onComplete: () => void }
> = ({
	method,
	data,
	id,
	title,
	successToast,
	errorToast,
	loadingToast,
	onComplete,
}) => {
	const {
		data: { isComplete, isFailed, output },
		isStreaming,
	} = useStreamingRpcQuery(method, data, ...reduceStreamingLogs);
	const cleanupTimerRef = useRef<NodeJS.Timeout | null>(null);
	const [isModalVisible, setModalVisible] = useState(false);
	const renderToast = useCallback(
		(children: React.ReactNode) => (
			<div className={'flex items-center'}>
				<span>{children}</span>
				<Button
					variant={'secondary'}
					className={'ml-2'}
					size={'sm'}
					onClick={() => {
						setModalVisible(true);
						toast.dismiss(id);
						clearTimeout(cleanupTimerRef.current!);
					}}
				>
					Logs
				</Button>
			</div>
		),
		[id],
	);
	useEffect(() => {
		if (isFailed) {
			toast.error(renderToast(errorToast), {
				id,
				duration: 10e3,
				position: 'bottom-right',
			});
			const timer = (cleanupTimerRef.current = setTimeout(onComplete, 3e3));
			return () => clearTimeout(timer);
		} else if (isComplete) {
			toast.success(successToast, {
				id,
				duration: 3e3,
				position: 'bottom-right',
			});
			const timer = (cleanupTimerRef.current = setTimeout(onComplete, 3e3));
			return () => clearTimeout(timer);
		} else if (isStreaming) {
			toast.loading(renderToast(loadingToast), {
				id,
				duration: Infinity,
				position: 'bottom-right',
			});
		} else {
			toast.dismiss(id);
		}
	}, [
		isComplete,
		isStreaming,
		loadingToast,
		successToast,
		id,
		onComplete,
		isFailed,
		errorToast,
		renderToast,
	]);

	return (
		<Modal
			show={isModalVisible}
			onClose={() => {
				setModalVisible(false);
				if (isStreaming) {
					toast.loading(renderToast(loadingToast), {
						id,
						duration: Infinity,
						position: 'bottom-right',
					});
				} else {
					onComplete();
				}
			}}
			fullHeight
		>
			<ModalTitle>
				<span className={'flex items-center'}>
					{isComplete && (
						<span className={'mr-2 flex items-center'}>
							<CheckCircleFillIcon />
						</span>
					)}
					{isFailed && (
						<span className={'mr-2 flex items-center'}>
							<AlertFillIcon />
						</span>
					)}
					{!isComplete && !isFailed && (
						<Spinner className={'mr-2 text-black'} />
					)}
					{title}
				</span>
			</ModalTitle>
			<ModalBody>
				<Monaco
					language={'logs'}
					value={`${output}\n`}
					options={{ readOnly: true }}
				/>
			</ModalBody>
		</Modal>
	);
};

const LogWindowManagerInternal: React.FC = () => {
	const { remoteCalls, setRemoteCalls } = useLogWindowManagerState();
	return (
		<>
			{remoteCalls.map((remoteCall) => (
				<LogWindowController
					key={remoteCall.id}
					{...remoteCall}
					onComplete={() =>
						setRemoteCalls((remoteCalls) =>
							remoteCalls.filter((rc) => rc.id !== remoteCall.id),
						)
					}
				/>
			))}
		</>
	);
};

export const LogWindowManager: React.FC = ({ children }) => {
	return (
		<LogWindowManagerProvider>
			{children}
			<LogWindowManagerInternal />
		</LogWindowManagerProvider>
	);
};
