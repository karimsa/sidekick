import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Dropdown, DropdownButton, DropdownContainer } from './Dropdown';
import { TriangleDownIcon } from '@primer/octicons-react';

interface SelectProps {
	id: string;
	disabled?: boolean;
	className?: string;

	value: string;
	onChange(value: string): void;
	options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({
	id,
	className,
	disabled,
	value,
	onChange,
	options,
}) => {
	useEffect(() => {
		if (!value && options.length > 0) {
			onChange(options[0].value);
		}
	}, [onChange, options, value]);

	const [isOpen, setOpen] = useState(false);

	return (
		<DropdownContainer className={'w-full'}>
			<div
				id={id}
				className={classNames(
					className,
					'bg-white border p-3 rounded cursor-pointer w-full flex items-center justify-between',
					{
						'pointer-events-none cursor-not-allowed': disabled,
					},
				)}
				onClick={() => setOpen(!isOpen)}
			>
				<span>{options.find((o) => o.value === value)?.label ?? value}</span>
				<TriangleDownIcon />
			</div>

			<Dropdown show={isOpen} onClose={() => setOpen(false)}>
				{options.map((option) => (
					<DropdownButton
						key={option.value}
						onClick={() => {
							onChange(option.value);
							setOpen(false);
						}}
					>
						{option.label}
						{option.value === value ? '*' : ''}
					</DropdownButton>
				))}
			</Dropdown>
		</DropdownContainer>
	);
};
