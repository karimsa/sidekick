import classNames from 'classnames';
import { useRef } from 'react';
import { isElmWithinTarget } from '../utils/isElmWithTarget';

interface ModalProps {
    show: boolean;
    onClose(): void;
}

export const Modal: React.FC<ModalProps> = ({ show, onClose, children }) => {
    const modalRef = useRef<HTMLDivElement | null>(null);

    return (
        <div
            className={classNames(
                'fixed flex items-center justify-center bg-black/50 top-0 left-0 w-full h-full transition-all duration-300',
                {
                    'opacity-0 pointer-events-none invisible': !show
                }
            )}
            onClick={evt => {
                if (!isElmWithinTarget(evt.target as any, modalRef.current)) {
                    onClose();
                }
            }}
        >
            <div ref={modalRef} className={'rounded bg-slate-100 w-2/3'}>
                {children}
            </div>
        </div>
    );
};

export const ModalTitle: React.FC = ({ children }) => {
    return (
        <div className={'w-full border-b p-5'}>
            <h3 className={'font-bold'}>{children}</h3>
        </div>
    );
};

export const ModalBody: React.FC = ({ children }) => {
    return <div className={'w-full p-5'}>{children}</div>;
};
