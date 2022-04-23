import * as React from 'react';
import { memo, useEffect, useState } from 'react';
import { useLazyStreamingRpcQuery } from './useStreamingQuery';
import { toast } from 'react-hot-toast';
import { Button, ButtonProps } from '../components/Button';
import { Modal, ModalBody, ModalTitle } from '../components/Modal';
import { Monaco } from '../components/Monaco';
import { StreamingRpcHandler } from '../utils/http';

function BackgroundMutationButtonInner<InputType>({
	handler,
	inputData,
	toastId,
	successMessage,
	loadingMessage,
	logsTitle,
	children,
	...buttonProps
}: {
	handler: StreamingRpcHandler<InputType, string>;
	inputData: InputType;
	toastId: string;
	successMessage: string;
	loadingMessage: string;
	logsTitle: string;
	children: React.ReactNode;
} & Omit<ButtonProps, 'onClick' | 'loading'>) {
	const { data, mutate, isStreaming } = useLazyStreamingRpcQuery(
		handler,
		(state, action) => {
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
	);
	const [isModalVisible, setModalVisible] = useState(false);
	useEffect(() => {
		if (data.isComplete) {
			toast.success(successMessage, {
				id: toastId,
				duration: 1e3,
				position: 'bottom-right',
			});
		}
	}, [data.isComplete, successMessage, toastId]);

	return (
		<>
			<Button
				{...buttonProps}
				loading={isStreaming}
				onClick={() => {
					toast.loading(
						<div className={'flex items-center'}>
							<span>{loadingMessage}</span>
							<Button
								variant={'secondary'}
								className={'ml-2'}
								size={'sm'}
								onClick={() => setModalVisible(true)}
							>
								Logs
							</Button>
						</div>,
						{
							id: toastId,
							duration: Infinity,
							position: 'bottom-right',
						},
					);
					mutate(inputData);
				}}
			>
				{children}
			</Button>

			<Modal
				show={isModalVisible}
				onClose={() => setModalVisible(false)}
				fullHeight
			>
				<ModalTitle>{logsTitle}</ModalTitle>
				<ModalBody>
					<Monaco language={'logs'} value={`${data.output}\n`} />
				</ModalBody>
			</Modal>
		</>
	);
}

export const BackgroundMutationButton = memo(
	BackgroundMutationButtonInner,
) as typeof BackgroundMutationButtonInner;
