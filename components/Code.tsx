import classNames from 'classnames';

export const Code: React.FC<{ className?: string }> = ({
	className,
	children,
}) => {
	return (
		<pre
			className={classNames(
				className,
				'font-mono my-5 p-5 rounded bg-gray-300 break-all overflow-auto',
			)}
		>
			<code>{children}</code>
		</pre>
	);
};
