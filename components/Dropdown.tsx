import * as React from 'react';
import { AnchorHTMLAttributes, useEffect, useRef } from 'react';
import Link from 'next/link';
import classNames from 'classnames';
import { isElmWithinTarget } from '../utils/isElmWithTarget';

export const DropdownContainer: React.FC<{ className?: string }> = ({
	className,
	children,
}) => {
	return (
		<div className={classNames(className, 'relative inline-flex flex-col')}>
			{children}
		</div>
	);
};

export const Dropdown: React.FC<{
	show: boolean;
	onClose(): void;
}> = ({ show, onClose, children }) => {
	const dropdownRef = useRef<HTMLUListElement | null>(null);
	useEffect(() => {
		if (show) {
			const onClickAnywhere = (evt: MouseEvent) => {
				if (!isElmWithinTarget(evt.target as any, dropdownRef.current)) {
					onClose();
				}
			};

			document.documentElement.addEventListener('click', onClickAnywhere);
			return () =>
				document.documentElement.removeEventListener('click', onClickAnywhere);
		}
	}, [onClose, show]);

	return (
		<ul
			ref={dropdownRef}
			className={classNames(
				'dropdown absolute min-w-full flex-col py-1 rounded bg-slate-300 z-20',
				{
					'inline-flex': show,
					hidden: !show,
				},
			)}
		>
			{children}
		</ul>
	);
};

export const DropdownLink: React.FC<
	Omit<AnchorHTMLAttributes<any>, 'href'> & { href: string }
> = ({ href, className = '', children, ...props }) => {
	return (
		<li>
			<Link href={href} passHref>
				<a
					className={`bg-slate-300 hover:bg-slate-400 p-2 block ${className}`}
					{...props}
				>
					{children}
				</a>
			</Link>
		</li>
	);
};

export const DropdownButton: React.FC<{
	onClick(): void;
	className?: string;
}> = ({ onClick, className = '', children, ...props }) => {
	return (
		<li>
			<button
				type={'button'}
				className={`bg-slate-300 hover:bg-slate-400 p-2 block w-full text-left ${className}`}
				onClick={onClick}
				{...props}
			>
				{children}
			</button>
		</li>
	);
};
