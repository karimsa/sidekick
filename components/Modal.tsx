import classNames from 'classnames';
import { createContext, useContext, useRef } from 'react';
import { isElmWithinTarget } from '../server/utils/isElmWithTarget';
import { XIcon } from '@primer/octicons-react';

interface ModalProps {
	show: boolean;
	fullHeight?: boolean;
	onClose(): void;
}

const ModalContext = createContext({ onClose() {} });

export const Modal: React.FC<ModalProps> = ({
	show,
	fullHeight,
	onClose,
	children,
}) => {
	const modalRef = useRef<HTMLDivElement | null>(null);

	return (
		<ModalContext.Provider value={{ onClose }}>
			<div
				className={classNames(
					'fixed flex items-center justify-center bg-black/50 top-0 left-0 w-full h-full transition-all duration-300 z-50',
					{
						'opacity-0 pointer-events-none invisible': !show,
					},
				)}
				onClick={(evt) => {
					if (!isElmWithinTarget(evt.target as any, modalRef.current)) {
						onClose();
					}
				}}
			>
				<div
					ref={modalRef}
					className={classNames('rounded bg-slate-100 w-2/3 flex flex-col', {
						'h-5/6': fullHeight,
					})}
				>
					{children}
				</div>
			</div>
		</ModalContext.Provider>
	);
};

export const ModalTitle: React.FC = ({ children }) => {
	const { onClose } = useContext(ModalContext);

	return (
		<div
			className={
				'w-full border-b p-5 flex flex-initial items-center justify-between'
			}
		>
			<h3 className={'font-bold'}>{children}</h3>
			<button
				type={'button'}
				className={'border-none p-0 m-0 flex items-center justify-center'}
				onClick={() => onClose()}
			>
				<XIcon />
			</button>
		</div>
	);
};

export const ModalBody: React.FC = ({ children }) => {
	return <div className={'w-full flex-1 p-5'}>{children}</div>;
};
