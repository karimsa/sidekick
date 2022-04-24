import * as React from 'react';
import classNames from 'classnames';

export const Toggle: React.FC<{
	id: string;
	value: boolean;
	onChange(value: boolean): void;
}> = ({ id, value, onChange }) => {
	return (
		<div
			className={classNames(
				'rounded-full w-8 h-3 cursor-pointer flex items-center',
				{
					'justify-end bg-emerald-700': value,
					'bg-slate-600': !value,
				},
			)}
			onClick={() => onChange(!value)}
		>
			<input
				id={id}
				type={'checkbox'}
				className={
					'rounded-full bg-white w-4 h-4 appearance-none cursor-pointer'
				}
				checked={value}
			/>
		</div>
	);
};
