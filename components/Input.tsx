import classNames from 'classnames';
import { forwardRef, KeyboardEvent } from 'react';

interface InputProps {
	type?: 'text' | 'number';
	className?: string;
	value: string;
	onChange(value: string): void;
	onKeyDown?: (evt: KeyboardEvent<HTMLInputElement>) => void;
	placeholder?: string;
	autoFocus?: boolean;
}

export const Input = forwardRef<HTMLInputElement | null, InputProps>(
	function Input(
		{
			type = 'text',
			className,
			value,
			onChange,
			onKeyDown,
			placeholder,
			autoFocus,
		},
		ref,
	) {
		return (
			<input
				ref={ref}
				className={classNames(className, 'rounded p-3 bg-white border')}
				type={type}
				value={value}
				onChange={(evt) => onChange(evt.target.value)}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				autoFocus={autoFocus}
			/>
		);
	},
);
