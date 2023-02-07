import constate from 'constate';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './Input';
import { Dropdown, DropdownButton, DropdownContainer } from './Dropdown';
import { toast } from 'react-hot-toast';
import { useLocalState } from '../hooks/useLocalState';
import { z } from 'zod';
import { useRpcQuery } from '../hooks/useQuery';
import { getConfig } from '../server/controllers/config';
import { useAsyncCallback } from 'react-async-hook';
import { Defined } from '../server/utils/util-types';

export interface CommandPaletteCommand {
	name: string;
	hotKey?: {
		key: string;
		metaKey?: boolean;
		ctrlKey?: boolean;
		altKey?: boolean;
		shiftKey?: boolean;
	};
	action: () => void;
}

function hotKeyString(hotKey: CommandPaletteCommand['hotKey']): string {
	if (!hotKey) {
		return ``;
	}
	return [
		hotKey.metaKey && 'Cmd',
		hotKey.ctrlKey && 'Ctrl',
		hotKey.altKey && 'Alt',
		hotKey.shiftKey && 'Shift',
		hotKey.key,
	]
		.filter(Boolean)
		.join(' + ');
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
				setCommands((cmds) => cmds.filter((cmd) => !newCommands.includes(cmd)));
		}, []),
	};
});

export { useCommandPalette };

function searchCommands(
	commands: CommandPaletteCommand[],
	query: string,
	cmdUsageFrequency: Record<string, number>,
) {
	if (!query.length) {
		return commands
			.map((command) => ({
				command,
				matches: [],
			}))
			.sort(
				(a, b) =>
					(cmdUsageFrequency[b.command.name] ?? 0) -
					(cmdUsageFrequency[a.command.name] ?? 0),
			);
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
		.sort(
			(a, b) =>
				(cmdUsageFrequency[b.command.name] ?? 0) -
				(cmdUsageFrequency[a.command.name] ?? 0),
		)
		.sort((a, b) => b.matches.length - a.matches.length);
}

function isHotkeyPressed(
	evt: KeyboardEvent,
	hotKey: CommandPaletteCommand['hotKey'],
) {
	if (!hotKey) {
		return false;
	}
	return (
		(hotKey.metaKey === undefined || hotKey.metaKey === evt.metaKey) &&
		(hotKey.ctrlKey === undefined || hotKey.ctrlKey === evt.ctrlKey) &&
		(hotKey.shiftKey === undefined || hotKey.shiftKey === evt.shiftKey) &&
		(hotKey.key === undefined || hotKey.key === evt.key)
	);
}

function getHotKeyFromString(keyString: string) {
	const hotKey: Defined<CommandPaletteCommand['hotKey']> = {
		key: '\0',
	};

	for (const key of keyString.toLowerCase().split(/\s+/g)) {
		switch (key) {
			case 'command':
			case 'cmd':
			case 'meta':
			case 'super':
			case 'win':
				hotKey.metaKey = true;
				break;

			case 'ctrl':
				hotKey.ctrlKey = true;
				break;

			case 'alt':
				hotKey.altKey = true;
				break;

			case 'shift':
				hotKey.shiftKey = true;
				break;

			default:
				hotKey.key = key;
				break;
		}
	}

	if (hotKey.key === '\0') {
		toast.error(`Invalid key mapping: '${keyString}'`);
		return null;
	}

	return hotKey;
}

async function executeKeyMapping({
	code,
	onOpen,
	onClose,
	commands,
}: {
	code: string;
	onOpen(): void;
	onClose(): void;
	commands: CommandPaletteCommand[];
}) {
	const runKeyMapping = new Function(
		`__sidekickHelpers`,
		`return (function(){ with (__sidekickHelpers) { ${code} } }())`,
	);
	return runKeyMapping({
		commandPalette: {
			open: () => onOpen(),
			close: () => onClose(),
			runByName(name: string) {
				const cmd = commands.find((cmd) => cmd.name === name);
				if (!cmd) {
					throw new Error(`Unrecognized command: '${name}'`);
				}
				cmd.action();
			},
		},
	});
}

const CommandPaletteInternal: React.FC = memo(function CommandPaletteInternal({
	children,
}) {
	const [isOpen, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [activeCommandIndex, setActiveCommandIndex] = useState(-1);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const { commands } = useCommandPalette();
	const [cmdUsageFrequency, setCmdUsageFrequency] = useLocalState(
		'cmdUsageFrequency',
		(s) => z.record(z.string(), z.number()).parse(s),
	);
	const { data: config, error: errLoadingConfig } = useRpcQuery(getConfig, {});

	useEffect(() => {
		if (errLoadingConfig) {
			toast.error(
				`Failed to load config, some commands might be missing from the command palette`,
			);
		}
	}, [errLoadingConfig]);

	const { execute: runKeyMapping, error } = useAsyncCallback(executeKeyMapping);
	useEffect(() => {
		if (error) {
			toast.error(`Key mapping command failed: ${error}`);
		}
	}, [error]);

	const userKeyMappings = useMemo(() => {
		if (config) {
			return Object.entries(config.keyMappings ?? {}).map(
				([keyString, code]) => ({
					hotKey: getHotKeyFromString(keyString),
					code,
				}),
			);
		}
		return [];
	}, [config]);

	useEffect(() => {
		const onKeyDown = (evt: KeyboardEvent) => {
			// Let user defined mappings come first
			const matchingUserKeyMapping = config?.enableKeyMappings
				? userKeyMappings.find(
						(keyMapping) =>
							keyMapping?.hotKey && isHotkeyPressed(evt, keyMapping.hotKey),
				  )
				: null;
			if (matchingUserKeyMapping) {
				evt.preventDefault();
				runKeyMapping({
					commands,
					onOpen: () => {
						setOpen(true);
						setQuery('');
						setActiveCommandIndex(0);
						inputRef.current?.focus();
					},
					onClose: () => {
						setOpen(false);
					},
					code: matchingUserKeyMapping.code,
				});
				return;
			}

			// As fallback
			if (
				!config?.enableKeyMappings &&
				(evt.metaKey || evt.ctrlKey) &&
				evt.key === 'p'
			) {
				evt.preventDefault();
				setOpen(true);
				setQuery('');
				setActiveCommandIndex(0);
				inputRef.current?.focus();
			}

			// Builtin for closing the command panel
			if (evt.key === 'Escape') {
				evt.preventDefault();
				setOpen(false);
				return;
			}

			// Finally, try matching with a registered command
			const matchingCmd = commands.find((cmd) =>
				isHotkeyPressed(evt, cmd.hotKey),
			);
			if (matchingCmd) {
				evt.preventDefault();
				matchingCmd.action();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [commands, config, runKeyMapping, userKeyMappings]);

	const matchingCommands = useMemo(
		() => searchCommands(commands, query.trim(), cmdUsageFrequency ?? {}),
		[cmdUsageFrequency, commands, query],
	);
	const dispatchCommand = useCallback(
		(command?: CommandPaletteCommand) => {
			setOpen(false);
			setQuery('');

			try {
				if (command) {
					setCmdUsageFrequency({
						...cmdUsageFrequency,
						[command.name]: (cmdUsageFrequency?.[command.name] ?? 0) + 1,
					});
					command.action();
				}
			} catch (err: any) {
				toast.error(
					`Failed to dispatch command ${command?.name}: ${err.message ?? err}`,
				);
			}
		},
		[cmdUsageFrequency, setCmdUsageFrequency],
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
									dispatchCommand(
										matchingCommands[activeCommandIndex]?.command,
									);
								}
							}}
							autoFocus
						/>

						{matchingCommands.length > 0 && (
							<DropdownContainer className={'w-full'}>
								<Dropdown show={true} onClose={() => setOpen(false)}>
									{matchingCommands.slice(0, 5).map((cmd, index) => (
										<DropdownButton
											key={cmd.command.name}
											onClick={() => dispatchCommand(cmd.command)}
											active={activeCommandIndex === index}
											className={`flex items-center justify-between`}
										>
											<span>
												{cmd.command.name
													.replace(/([^\W]+)(\W)/g, '$1$2\0')
													.split('\0')
													.map((word) => {
														if (
															cmd.matches.some((m) =>
																word.toLowerCase().startsWith(m),
															)
														) {
															return <b key={word}>{word}</b>;
														}
														return word;
													})}
											</span>
											{cmd.command.hotKey && config?.enableKeyMappings && (
												<span className={`flex items-center`}>
													{hotKeyString(cmd.command.hotKey)}
												</span>
											)}
										</DropdownButton>
									))}
									{matchingCommands.length > 5 && (
										<DropdownButton className={'text-sm'} onClick={() => {}}>
											and {matchingCommands.length - 5} hidden options...
										</DropdownButton>
									)}
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
