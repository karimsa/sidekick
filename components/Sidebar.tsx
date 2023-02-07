import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	PackageIcon,
	ToolsIcon,
	HomeIcon,
	RocketIcon,
} from '@primer/octicons-react';
import { useRouter } from 'next/router';
import classNames from 'classnames';
import Tooltip from '@tippyjs/react';
// @ts-ignore
import octicons from '@primer/octicons';

import { useLocalState } from '../hooks/useLocalState';
import { useRpcQuery } from '../hooks/useQuery';
import { getExtensions } from '../server/controllers/extensions';
import { toast } from 'react-hot-toast';
import { useCommandPalette } from './CommandPalette';
import { getVersion } from '../server/controllers/config';
import { Modal, ModalBody } from './Modal';
import {
	checkForSidekickUpdates,
	setSidekickChannel,
	upgradeSidekick,
} from '../server/controllers/upgrade';
import { AlertCard } from './AlertCard';
import { Code } from './Code';
import { Badge } from './Badge';
import type { ReleaseChannel } from '../server/services/config';
import { Button } from './Button';
import { Select } from './Select';
import { useRpcMutation } from '../hooks/useMutation';
import { Spinner } from './Spinner';

function getExtensionIcon(name: string) {
	const icon = octicons[name];
	if (!icon) {
		console.error(`Unrecognized icon: ${name}`);
		return '';
	}
	return icon.toSVG();
}

const ChannelBadge: React.FC<{
	className?: string;
	channel: ReleaseChannel;
}> = ({ className, channel }) => (
	<Badge
		size="xs"
		className={classNames(className, {
			'bg-emerald-700': channel === 'stable',
			'bg-yellow-600': channel === 'beta',
			'bg-red-600': channel === 'nightly' || channel === 'dev',
		})}
	>
		{channel}
	</Badge>
);

interface SidebarLinkProps {
	icon: React.ReactNode;
	label?: string;
	showLabel: boolean;
	className?: string;
	href?: string;
	onClick?: () => void;
}

function SidebarLink({
	className,
	label,
	showLabel,
	href,
	icon,
	onClick,
}: SidebarLinkProps) {
	const router = useRouter();

	return (
		<Tooltip content={label} placement={'right'} disabled={showLabel}>
			<a
				href={href || '#'}
				onClick={(evt) => {
					evt.preventDefault();
					if (href) {
						router.push(href);
					} else if (onClick) {
						onClick();
					} else {
						throw new Error(`No action assigned to sidebar link`);
					}
				}}
				className={classNames(
					className,
					'flex items-center p-5 hover:bg-slate-700',
					{
						'bg-emerald-900': href === router.asPath,
					},
				)}
			>
				{/* the h-7 makes the icon the same size as the text, so closing/opening the sidebar isn't jarring */}
				<span
					className={classNames('flex items-center h-7', {
						'pr-5': showLabel,
					})}
				>
					{icon}
				</span>
				{showLabel && <span className={'text-lg'}>{label}</span>}
			</a>
		</Tooltip>
	);
}

const ChangeSidekickChannelForm: React.FC<{
	onUpdateChannel(channel: ReleaseChannel): void;
}> = ({ onUpdateChannel }) => {
	const {
		data: updateInfo,
		isLoading,
		error,
	} = useRpcQuery(checkForSidekickUpdates, {});

	const [selectedChannel, setSelectedChannel] =
		useState<ReleaseChannel>('stable');
	useEffect(() => {
		if (updateInfo && updateInfo.channel !== 'dev') {
			setSelectedChannel(updateInfo.channel);
		}
	}, [updateInfo]);

	return (
		<form>
			<div className="flex items-center">
				<label htmlFor="channel" className="text-black mr-2 shrink-0">
					Active channel
				</label>
				<div className="grow">
					<Select
						id="channel"
						className="text-black"
						disabled={isLoading || !!error}
						value={selectedChannel}
						onChange={(channel) =>
							setSelectedChannel(channel as unknown as ReleaseChannel)
						}
						options={['stable', 'beta', 'nightly'].map((channel) => ({
							label: channel,
							value: channel,
						}))}
					/>
				</div>
			</div>
			<div className="mt-1">
				{selectedChannel === 'stable' && (
					<p className="text-black text-sm">
						The stable channel is ideal for people that don&apos;t want to deal
						with sidekick bugs and are happy to wait for features to be
						released.
					</p>
				)}
				{selectedChannel === 'beta' && (
					<p className="text-black text-sm">
						The beta channel receives features a few days ahead of stable, and
						is therefore mostly stable. Occassionally, beta will require minor
						bug fixes.
					</p>
				)}
				{selectedChannel === 'nightly' && (
					<p className="text-black text-sm">
						The nightly channel receives features that are mostly dev-complete,
						but are still experiencing bugs. Nightly requires fixes regularly.
					</p>
				)}
			</div>
			{updateInfo && updateInfo.channel !== selectedChannel && (
				<>
					<div className="mt-5 flex justify-center">
						<Button
							variant="primary"
							onClick={() => onUpdateChannel(selectedChannel)}
						>
							Switch to {selectedChannel}
						</Button>
					</div>
					<div>
						<p className="text-xs text-black text-center mt-2">
							Sidekick will automatically restart in-place after channel switch
							is complete.
						</p>
					</div>
				</>
			)}
		</form>
	);
};

const CheckForUpdatesButton: React.FC = () => {
	const [isModalVisible, setModalVisible] = React.useState(false);

	const {
		data: updateInfo,
		isLoading,
		error,
		refetch,
	} = useRpcQuery(checkForSidekickUpdates, {});

	const { mutate: performUpgrade, isLoading: isUpgradingCurrentChannel } =
		useRpcMutation(upgradeSidekick, {
			onSuccess: () => {
				window.location.reload();
			},
			onError: (error) => {
				toast.error(`Failed to upgrade sidekick: ${(error as Error).message}`);
				console.error(error);
			},
		});
	const { mutate: performSetSidekickChannel, isLoading: isSwitchingChannel } =
		useRpcMutation(setSidekickChannel, {
			onSuccess: () => {
				window.location.reload();
			},
			onError: (error) => {
				toast.error(`Failed to upgrade sidekick: ${(error as Error).message}`);
				console.error(error);
			},
		});

	const isUpgrading = isUpgradingCurrentChannel || isSwitchingChannel;

	return (
		<>
			<Tooltip
				content={
					updateInfo?.needsUpgrade
						? 'Update is available'
						: 'No updates available.'
				}
				placement={'top'}
			>
				<button
					type="button"
					className={classNames(
						'rounded m-2 p-2 pt-1 cursor-pointer relative',
						{
							'bg-emerald-700 hover:bg-emerald-800': updateInfo?.needsUpgrade,
							'bg-slate-600 hover:bg-slate-700': !updateInfo?.needsUpgrade,
						},
					)}
					onClick={() => {
						setModalVisible(true);
						refetch();
					}}
				>
					{updateInfo?.needsUpgrade && (
						<span className="flex h-3 w-3 absolute top-0 right-0 -mt-1 -mr-1">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
							<span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
						</span>
					)}

					<RocketIcon />
				</button>
			</Tooltip>

			<Modal
				show={isModalVisible}
				onClose={() => {
					if (!isUpgrading) {
						setModalVisible(false);
					}
				}}
				size="sm"
			>
				<ModalBody>
					{error && (
						<div className="mb-5">
							<AlertCard title={'Failed to fetch upgrade information'}>
								<Code>{String(error)}</Code>
							</AlertCard>
						</div>
					)}
					{isLoading && <p className="text-black">Checking for updates ...</p>}
					{isUpgrading && (
						<>
							<p className="text-base text-black text-center mb-5">
								Sidekick upgrade is in-progress. Sidekick will refresh shortly.
							</p>

							<div className="w-full flex items-center justify-center">
								<Spinner className="text-emerald-700" />
							</div>
						</>
					)}
					{updateInfo && !isUpgrading && (
						<>
							<p className="text-lg text-black text-center mb-2">
								You are running sidekick{' '}
								<Badge
									className={classNames({
										'bg-cyan-600': updateInfo.needsUpgrade,
										'bg-emerald-700': !updateInfo.needsUpgrade,
									})}
								>
									v{updateInfo.currentVersion}
								</Badge>{' '}
								on the <ChannelBadge channel={updateInfo.channel} /> channel.
							</p>

							{updateInfo.channel === 'dev' && (
								<p className="text-lg text-black text-center mt-5">
									The dev channel cannot be updated.
								</p>
							)}

							{!updateInfo.needsUpgrade && updateInfo.channel !== 'dev' && (
								<p className="text-lg text-black text-center mt-5">
									🚀 You are running the latest version of sidekick.
								</p>
							)}

							{updateInfo.needsUpgrade && (
								<>
									<p className="text-lg text-black text-center mb-5">
										You can now upgrade to{' '}
										<Badge className="bg-emerald-700">
											v{updateInfo.latestVersion}
										</Badge>
										.
									</p>

									{updateInfo.channel === 'stable' && (
										<p className="text-lg text-black text-center mb-5">
											Sidekick stable must be upgraded using your package
											manager.
										</p>
									)}

									<div className="w-full flex items-center justify-center">
										{updateInfo.channel !== 'stable' && (
											<Button
												variant="primary"
												className="mr-5"
												onClick={() => performUpgrade({})}
											>
												Upgrade
											</Button>
										)}
										{updateInfo.channel !== 'dev' && (
											<Button
												variant="info"
												onClick={() =>
													window.open(
														{
															stable: `https://github.com/karimsa/sidekick/releases/tag/v${updateInfo.latestVersion}`,
															beta: `https://github.com/karimsa/sidekick/commits/main`,
															nightly: `https://github.com/karimsa/sidekick/commits/develop`,
															dev: 'about:blank',
														}[updateInfo.channel],
														'_blank',
													)
												}
											>
												Release notes
											</Button>
										)}
									</div>

									{updateInfo.channel !== 'stable' && (
										<div>
											<p className="text-xs text-black text-center mt-2">
												Sidekick will automatically restart in-place after
												upgrade.
											</p>
										</div>
									)}
								</>
							)}

							<hr className="w-1/2 h-1 mx-auto my-5 bg-gray-300 border-0 rounded" />

							<ChangeSidekickChannelForm
								onUpdateChannel={(channel) =>
									performSetSidekickChannel({ channel })
								}
							/>
						</>
					)}
				</ModalBody>
			</Modal>
		</>
	);
};

export const Sidebar: React.FC<{
	isOpen: boolean;
	setOpen(open: boolean): void;
}> = ({ isOpen, setOpen }) => {
	const router = useRouter();
	const { data: extensions } = useRpcQuery(
		getExtensions,
		{},
		{
			onError(error: any) {
				toast.error(`Failed to load extensions: ${error.message ?? error}`);
			},
		},
	);

	const links: Omit<SidebarLinkProps, 'showLabel'>[] = useMemo(
		() => [
			{
				icon: <PackageIcon />,
				href: '/servers',
				label: 'Dev Servers',
			},
			...(extensions ?? []).map((extension) => ({
				icon: (
					<span
						style={{ fill: 'white' }}
						dangerouslySetInnerHTML={{
							__html: getExtensionIcon(extension.icon),
						}}
					/>
				),
				href: `/extensions/${extension.id}`,
				label: extension.name,
			})),
			{
				icon: <ToolsIcon />,
				href: '/settings',
				label: 'Settings',
			},
			{
				icon: isOpen ? <ArrowLeftIcon /> : <ArrowRightIcon />,
				onClick: () => setOpen(!isOpen),
				label: 'Close sidebar',
			},
		],
		[extensions, isOpen, setOpen],
	);

	const { registerCommands } = useCommandPalette();
	React.useEffect(
		() =>
			registerCommands([
				...links.flatMap(({ label, href }, idx) =>
					href
						? [
								{
									name: `Goto ${label}`,
									hotKey:
										label === 'Settings'
											? {
													metaKey: true,
													key: ',',
											  }
											: {
													ctrlKey: true,
													key: String(idx + 1),
											  },
									action: () => {
										router.push(href);
									},
								},
						  ]
						: [],
				),
				{
					name: `${isOpen ? 'Close' : 'Open'} sidebar`,
					action: () => setOpen(!isOpen),
				},
			]),
		[isOpen, links, registerCommands, router, setOpen],
	);

	useEffect(() => {
		for (const { href } of links) {
			if (href) {
				router.prefetch(href);
			}
		}
	}, [links, router]);

	const { data: versionInfo } = useRpcQuery(getVersion, {});

	return (
		<div
			className={
				'flex-initial flex flex-col justify-between bg-slate-900 text-white'
			}
		>
			<div>
				<ul>
					{links.map((link) => (
						<li key={link.label}>
							<SidebarLink {...link} showLabel={isOpen} />
						</li>
					))}
				</ul>
			</div>

			<div
				className={classNames('flex items-center', {
					'justify-between': isOpen,
					'justify-center': !isOpen,

					'flex-row': isOpen,
					'flex-col': !isOpen,
				})}
			>
				<Tooltip content={'Home'} placement={'top'}>
					<div>
						<Link href="/" passHref>
							<a
								className={
									'rounded m-2 p-2 pt-1 bg-slate-600 hover:bg-slate-700 cursor-pointer block'
								}
							>
								<HomeIcon />
							</a>
						</Link>
					</div>
				</Tooltip>

				{versionInfo && isOpen && (
					<>
						<div className={'px-5 flex flex-col justify-center'}>
							<p>
								<span>v{versionInfo.sidekick.version}</span>
								{versionInfo.sidekick.releaseChannel !== 'stable' && (
									<Badge
										size="xs"
										className={classNames('ml-2', {
											'bg-yellow-600':
												versionInfo.sidekick.releaseChannel === 'beta',
											'bg-red-600':
												versionInfo.sidekick.releaseChannel === 'nightly' ||
												versionInfo.sidekick.releaseChannel === 'dev',
										})}
									>
										{versionInfo.sidekick.releaseChannel}
									</Badge>
								)}
							</p>
						</div>

						<CheckForUpdatesButton />
					</>
				)}

				{versionInfo && !isOpen && <CheckForUpdatesButton />}
			</div>
		</div>
	);
};

export function withSidebar<T extends { children?: React.ReactNode }>(
	Main: React.FC<T>,
	{ noPadding }: { noPadding?: boolean } = {},
): React.FC<T> {
	return function SidebarWrappedComponent(props: T) {
		const [isOpen, setOpen] = useLocalState('sidebarOpen', Boolean);

		// We want to avoid rendering sidebar on the server, because we need localStorage
		// to correctly render it
		// Two-pass rendering is recommended by the React team for client-side only
		// component renders
		const [showSidebar, setShowSidebar] = useState(false);
		useEffect(() => {
			setShowSidebar(true);
		}, []);

		return (
			<>
				{showSidebar && <Sidebar isOpen={!!isOpen} setOpen={setOpen} />}
				<main
					className={classNames('flex flex-col flex-auto bg-slate-700', {
						'p-5': !noPadding,
					})}
				>
					<Main {...props} />
				</main>
			</>
		);
	};
}
