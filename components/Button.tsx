import * as React from 'react';
import { forwardRef } from 'react';
import classNames from 'classnames';
import { Spinner } from './Spinner';

const ButtonVariants = {
	primary: 'bg-emerald-900 hover:bg-emerald-800 text-white',
	secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
	danger: 'bg-red-600 hover:bg-red-800 text-white',
	warning: 'bg-amber-500 hover:bg-amber-600 text-black',
	info: 'bg-cyan-500 hover:bg-cyan-600 text-black',
};

const ButtonSizes = {
	sm: 'px-2 py-1',
	md: 'px-2 py-2',
	lg: 'px-4 py-3',
};

export interface ButtonProps {
	variant: keyof typeof ButtonVariants;
	ref?: React.Ref<unknown>;

	type?: 'button' | 'submit';
	size?: keyof typeof ButtonSizes;
	className?: string;
	style?: React.CSSProperties;
	onClick?: () => void;
	loading?: boolean;
	disabled?: boolean;
	icon?: React.ReactElement;
}

export const Button: React.FC<ButtonProps> = forwardRef(function Button(
	{
		loading,
		disabled,
		variant,
		size = 'md',
		className,
		type = 'button',
		icon,
		children,
		onClick,
	},
	ref,
) {
	return (
		<button
			ref={ref as any}
			className={classNames(
				'rounded inline-flex items-center justify-center',
				ButtonVariants[variant],
				ButtonSizes[size],
				className,
				(disabled || loading) && 'pointer-events-none opacity-50',
			)}
			type={type}
			onClick={onClick}
			disabled={loading || disabled}
		>
			{loading && <Spinner className={'text-white mr-2'} />}
			{!loading && icon && (
				<span className={classNames('mr-2 inline-flex items-center')}>
					{icon}
				</span>
			)}
			<span>{children}</span>
		</button>
	);
});

export const IconButton: React.FC<Omit<ButtonProps, 'icon'>> = ({
	className,
	children,
	...props
}) => {
	return (
		<Button className={classNames(className, 'px-3')} {...props}>
			{children}
		</Button>
	);
};
