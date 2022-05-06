import { StreamingRpcAction, useStreamingRpcQuery } from './useStreamingQuery';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '../components/Button';
import { Modal, ModalBody, ModalTitle } from '../components/Modal';
import { Monaco } from '../components/Monaco';
import { Spinner } from '../components/Spinner';
import { CheckCircleFillIcon } from '@primer/octicons-react';
import constate from 'constate';
import { StreamingRpcHandler } from '../server/utils/http';

type LogState = { isComplete: boolean; output: string };
type LogAction = StreamingRpcAction<string, never>;

export const reduceStreamingLogs = [
	(state: LogState, action: LogAction): LogState => {
		switch (action.type) {
			case 'open':
				return { isComplete: false, output: '' };
			case 'data':
				return { ...state, output: state.output + action.data };
			case 'error':
				return {
					...state,
					isComplete: true,
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
	{ isComplete: false, output: '' },
	{ autoRetry: false },
] as const;

// TODO: Clear entry from remoteCalls after completion/failure

interface LogWindowRemoteCall<T> {
	id: string;
	title: string;
	successToast: string;
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

const LogWindowController: React.FC<LogWindowRemoteCall<any>> = ({
	method,
	data,
	id,
	title,
	successToast,
	loadingToast,
}) => {
	const {
		data: { isComplete, output },
		isStreaming,
	} = useStreamingRpcQuery(method, data, ...reduceStreamingLogs);
	const [isModalVisible, setModalVisible] = useState(false);
	const showLoadingToast = useCallback(
		() =>
			toast.loading(
				<div className={'flex items-center'}>
					<span>{loadingToast}</span>
					<Button
						variant={'secondary'}
						className={'ml-2'}
						size={'sm'}
						onClick={() => {
							setModalVisible(true);
							toast.dismiss(id);
						}}
					>
						Logs
					</Button>
				</div>,
				{
					id,
					duration: Infinity,
					position: 'bottom-right',
				},
			),
		[loadingToast, id],
	);
	useEffect(() => {
		if (isComplete) {
			toast.success(successToast, {
				id,
				duration: 1e3,
				position: 'bottom-right',
			});
		} else if (isStreaming) {
			showLoadingToast();
		} else {
			toast.dismiss(id);
		}
	}, [
		isComplete,
		isStreaming,
		loadingToast,
		showLoadingToast,
		successToast,
		id,
	]);

	return (
		<Modal
			show={isModalVisible}
			onClose={() => {
				setModalVisible(false);
				if (isStreaming) {
					showLoadingToast();
				}
			}}
			fullHeight
		>
			<ModalTitle>
				<span className={'flex items-center'}>
					{isComplete ? (
						<span className={'mr-2 flex items-center'}>
							<CheckCircleFillIcon />
						</span>
					) : (
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
	const { remoteCalls } = useLogWindowManagerState();
	return (
		<>
			{remoteCalls.map((remoteCall) => (
				<LogWindowController key={remoteCall.id} {...remoteCall} />
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
