import * as React from 'react';
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	PackageIcon,
	ToolsIcon,
	HomeIcon,
} from '@primer/octicons-react';
import { useRouter } from 'next/router';
import classNames from 'classnames';
import Tooltip from '@tippyjs/react';
// @ts-ignore
import octicons from '@primer/octicons';

// import { InboxItems } from './InboxItems';
import { useLocalState } from '../hooks/useLocalState';
import { useRpcQuery } from '../hooks/useQuery';
import { getExtensions } from '../server/controllers/extensions';
import { toast } from 'react-hot-toast';
import { useCommandPalette } from './CommandPalette';
import { getVersion } from '../server/controllers/config';

function getExtensionIcon(name: string) {
	const icon = octicons[name];
	if (!icon) {
		console.error(`Unrecognized icon: ${name}`);
		return '';
	}
	return icon.toSVG();
}

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
				className={classNames('flex flex-row', {
					'justify-center': !isOpen,
				})}
			>
				<Tooltip content={'Home'} placement={'top'}>
					<Link href="/" passHref>
						<a
							className={
								'rounded m-2 p-2 pt-1 bg-slate-600 hover:bg-slate-700 cursor-pointer'
							}
						>
							<HomeIcon />
						</a>
					</Link>
				</Tooltip>

				{versionInfo && isOpen && (
					<div className={'px-5 flex flex-col justify-center'}>
						<p>
							<span>v{versionInfo.sidekick.version}</span>
							{versionInfo.sidekick.releaseChannel !== 'stable' && (
								<span
									className={classNames('rounded p-1 text-xs ml-2', {
										'bg-yellow-600':
											versionInfo.sidekick.releaseChannel === 'beta',
										'bg-red-600':
											versionInfo.sidekick.releaseChannel === 'nightly' ||
											versionInfo.sidekick.releaseChannel === 'dev',
									})}
								>
									{versionInfo.sidekick.releaseChannel}
								</span>
							)}
						</p>
					</div>
				)}
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

		return (
			<>
				{/* Avoid rendering sidebar on the server, because we need localStorage to correctly render */}
				{global.window && <Sidebar isOpen={!!isOpen} setOpen={setOpen} />}
				<main
					className={classNames('flex flex-col flex-auto bg-slate-700', {
						'p-5': !noPadding,
					})}
				>
					<div className={'w-full d-flex flex-initial'}>
						{/*    <InboxItems />*/}
					</div>

					<Main {...props} />
				</main>
			</>
		);
	};
}
