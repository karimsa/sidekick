import { StreamingRpcAction } from './useStreamingQuery';
import * as React from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '../components/Button';
import { Modal, ModalBody, ModalTitle } from '../components/Modal';
import { Monaco } from '../components/Monaco';
import { Spinner } from '../components/Spinner';
import { CheckCircleFillIcon } from '@primer/octicons-react';

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

export const LogWindow: React.FC<{
	windowId: string;
	title: string;
	successToast: string;
	loadingToast: string;
	data: LogState;
	isStreaming: boolean;
}> = memo(function LogWindow({
	windowId,
	title,
	successToast,
	loadingToast,
	data: { isComplete, output },
	isStreaming,
}) {
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
							toast.dismiss(windowId);
						}}
					>
						Logs
					</Button>
				</div>,
				{
					id: windowId,
					duration: Infinity,
					position: 'bottom-right',
				},
			),
		[loadingToast, windowId],
	);
	useEffect(() => {
		if (isComplete) {
			toast.success(successToast, {
				id: windowId,
				duration: 1e3,
				position: 'bottom-right',
			});
		} else if (isStreaming) {
			showLoadingToast();
		} else {
			toast.dismiss(windowId);
		}
	}, [
		isComplete,
		isStreaming,
		loadingToast,
		showLoadingToast,
		successToast,
		windowId,
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
});
