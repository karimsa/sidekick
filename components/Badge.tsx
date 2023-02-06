import classNames from 'classnames';
import React from 'react';

export type BadgeProps = React.PropsWithChildren<{
	size?: 'lg' | 'md' | 'sm' | 'xs';
	className: string;
}>;

export const Badge: React.FC<BadgeProps> = ({
	className,
	size = 'sm',
	children,
}) => {
	return (
		<span
			className={classNames('rounded p-1 text-white', className, {
				'text-xs': size === 'xs',
				'text-sm': size === 'sm',
				'text-base': size === 'md',
				'text-lg': size === 'lg',
			})}
		>
			{children}
		</span>
	);
};
