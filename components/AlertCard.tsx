import * as React from 'react';
import classNames from 'classnames';
import { XCircleFillIcon } from '@primer/octicons-react';

export const AlertCard: React.FC<{
	title: string;
	borderColor?: string;
	children: React.ReactNode;
}> = ({ title, borderColor = 'border-red-600', children }) => {
	return (
		<div className={classNames('p-5 border-t-4 bg-white rounded', borderColor)}>
			<p className={'text-red-600 mb-5 flex items-center'}>
				<XCircleFillIcon />
				<span className={'ml-2'}>{title}</span>
			</p>
			{children}
		</div>
	);
};

export const Alert: React.FC<{ bgColor?: string; className?: string }> = ({
	className,
	bgColor = 'bg-red-600',
	children,
}) => {
	return (
		<div
			className={classNames(
				bgColor,
				className,
				'p-3 text-sm rounded flex items-center',
			)}
		>
			{children}
		</div>
	);
};
