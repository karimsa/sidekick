import * as React from 'react';
import { AnchorHTMLAttributes } from 'react';
import Link from 'next/link';
import classNames from 'classnames';

export const DropdownContainer: React.FC = ({ children }) => {
    return <div className={'inline-flex flex-col'}>{children}</div>;
};

export const Dropdown: React.FC<{
    show: boolean;
}> = ({ show, children }) => {
    return (
        <ul
            className={classNames('flex-col py-1 rounded-b bg-slate-300', {
                'inline-flex': show,
                hidden: !show
            })}
        >
            {children}
        </ul>
    );
};

export const DropdownLink: React.FC<Omit<AnchorHTMLAttributes<any>, 'href'> & { href: string }> = ({
    href,
    className = '',
    children,
    ...props
}) => {
    return (
        <li>
            <Link href={href} passHref>
                <a className={`bg-slate-300 hover:bg-slate-400 p-2 block ${className}`} {...props}>
                    {children}
                </a>
            </Link>
        </li>
    );
};

export const DropdownButton: React.FC<{ onClick(): void; className?: string }> = ({
    onClick,
    className = '',
    children,
    ...props
}) => {
    return (
        <li>
            <button
                className={`bg-slate-300 hover:bg-slate-400 p-2 block w-full text-left ${className}`}
                onClick={onClick}
                {...props}
            >
                {children}
            </button>
        </li>
    );
};
