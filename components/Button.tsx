import * as React from 'react';
import classNames from 'classnames';
import { Spinner } from './Spinner';

const ButtonVariants = {
    primary: 'bg-emerald-900 hover:bg-emerald-800 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
    danger: 'bg-red-600 hover:bg-red-800 text-white'
};

const ButtonSizes = {
    sm: 'px-2 py-1',
    md: 'px-2 py-2',
    lg: 'px-4 py-3'
};

export interface ButtonProps {
    variant: keyof typeof ButtonVariants;

    type?: 'button' | 'submit';
    size?: keyof typeof ButtonSizes;
    className?: string;
    style?: React.CSSProperties;
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
    icon?: React.ReactElement;
}

export const Button: React.FC<ButtonProps> = ({
    loading,
    disabled,
    variant,
    size = 'md',
    className,
    type = 'button',
    icon,
    children,
    onClick
}) => {
    return (
        <button
            className={classNames(
                'rounded inline-flex items-center',
                ButtonVariants[variant],
                ButtonSizes[size],
                className,
                (disabled || loading) && 'pointer-events-none opacity-50'
            )}
            type={type}
            onClick={onClick}
            disabled={loading || disabled}
        >
            {loading && <Spinner className={'text-white mr-2'} />}
            {!loading && icon && <span className={'mr-2'}>{icon}</span>}
            {children}
        </button>
    );
};
