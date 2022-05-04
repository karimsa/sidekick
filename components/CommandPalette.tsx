import constate from 'constate';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './Input';
import { Dropdown, DropdownButton, DropdownContainer } from './Dropdown';

export interface CommandPaletteCommand {
	name: string;
	action: () => void;
}

const [CommandPaletteProvider, useCommandPalette] = constate(() => {
	const [commands, setCommands] = useState<CommandPaletteCommand[]>([]);
	return {
		commands,
		registerCommand: useCallback((command: CommandPaletteCommand) => {
			setCommands((cmds) => [...cmds, command]);
			return () => setCommands((cmds) => cmds.filter((c) => c !== command));
		}, []),
		registerCommands: useCallback((newCommands: CommandPaletteCommand[]) => {
			setCommands((cmds) => [...cmds, ...newCommands]);
			return () =>
				setCommands((cmds) =>
					cmds.filter((c) => !newCommands.some((cmd) => cmd.name === c.name)),
				);
		}, []),
	};
});

export { useCommandPalette };

function searchCommands(commands: CommandPaletteCommand[], query: string) {
	if (!query.length) {
		return commands.slice(0, 5).map((command) => ({
			command,
			matches: [],
		}));
	}

	return commands
		.flatMap((command) => {
			const tokenizedQuery = query.toLowerCase().split(/\W/g).filter(Boolean);
			const tokenizedText = command.name
				.toLowerCase()
				.split(/\W/g)
				.filter(Boolean);
			const matches = tokenizedText.filter((word) =>
				tokenizedQuery.some((q) => word.startsWith(q)),
			);

			return matches.length < tokenizedQuery.length
				? []
				: [
						{
							command,
							matches,
						},
				  ];
		})
		.sort((a, b) => b.matches.length - a.matches.length)
		.slice(0, 5);
}

const CommandPaletteInternal: React.FC = memo(function CommandPaletteInternal({
	children,
}) {
	const [isOpen, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [activeCommandIndex, setActiveCommandIndex] = useState(-1);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const { commands } = useCommandPalette();

	useEffect(() => {
		const onKeyDown = (evt: KeyboardEvent) => {
			if (evt.metaKey && evt.key === 'p') {
				evt.preventDefault();
				setOpen(true);
				setQuery('');
				setActiveCommandIndex(0);
				inputRef.current?.focus();
			}
		};
		window.addEventListener('keydown', onKeyDown, { capture: true });
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	const matchingCommands = useMemo(
		() => searchCommands(commands, query.trim()),
		[commands, query],
	);

	return (
		<>
			{isOpen && (
				<div
					className={
						'h-full w-full bg-black/25 absolute top-0 left-0 z-50 flex flex-col items-center pt-12'
					}
					onClick={() => setOpen(false)}
				>
					<div className="w-1/3">
						<Input
							ref={inputRef}
							type={'text'}
							className={'w-full bg-slate-600 outline-none text-white'}
							placeholder={'Run a command or shortcut'}
							value={query}
							onChange={setQuery}
							onKeyDown={(evt) => {
								if (evt.key === 'ArrowDown') {
									setActiveCommandIndex((i) =>
										Math.min(matchingCommands.length - 1, i + 1),
									);
								} else if (evt.key === 'ArrowUp') {
									setActiveCommandIndex((i) => Math.max(0, i - 1));
								} else if (evt.key === 'Enter') {
									matchingCommands[activeCommandIndex]?.command.action();
									setOpen(false);
								}
							}}
							autoFocus
						/>

						{matchingCommands.length > 0 && (
							<DropdownContainer className={'w-full'}>
								<Dropdown show={true} onClose={() => {}}>
									{matchingCommands.map((cmd, index) => (
										<DropdownButton
											key={cmd.command.name}
											onClick={() => cmd.command.action()}
											active={activeCommandIndex === index}
										>
											{cmd.command.name
												.replace(/([^\W]+)(\W)/g, '$1$2\0')
												.split('\0')
												.map((word) => {
													if (
														cmd.matches.some((m) =>
															word.toLowerCase().startsWith(m),
														)
													) {
														return <b>{word}</b>;
													}
													return word;
												})}
										</DropdownButton>
									))}
								</Dropdown>
							</DropdownContainer>
						)}
					</div>
				</div>
			)}

			{children}
		</>
	);
});

export const CommandPalette: React.FC = memo(function CommandPalette({
	children,
}) {
	return (
		<CommandPaletteProvider>
			<CommandPaletteInternal>{children}</CommandPaletteInternal>
		</CommandPaletteProvider>
	);
});
