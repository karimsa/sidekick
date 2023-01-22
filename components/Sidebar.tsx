import * as React from 'react';
import { useEffect, useMemo } from 'react';
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	PackageIcon,
	ToolsIcon,
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

	const links = useMemo(
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
				...links.flatMap((link, idx) =>
					link.href
						? [
								{
									name: `Goto ${link.label}`,
									hotKey:
										link.label === 'Settings'
											? {
													metaKey: true,
													key: ',',
											  }
											: {
													ctrlKey: true,
													key: String(idx + 1),
											  },
									action: () => {
										router.push(link.href);
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
					{links.map(({ icon, href, onClick, label }) => (
						<li key={label}>
							<Tooltip content={label} placement={'right'} disabled={isOpen}>
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
										'flex items-center p-5 hover:bg-slate-700',
										{
											'bg-emerald-900': href === router.asPath,
										},
									)}
								>
									{/* the h-7 makes the icon the same size as the text, so closing/opening the sidebar isn't jarring */}
									<span
										className={classNames('flex items-center h-7', {
											'pr-5': isOpen,
										})}
									>
										{icon}
									</span>
									{isOpen && <span className={'text-lg'}>{label}</span>}
								</a>
							</Tooltip>
						</li>
					))}
				</ul>
			</div>

			{versionInfo && isOpen && (
				<div className={'p-5'}>
					<p>
						Sidekick v{versionInfo.sidekick.version} (
						{versionInfo.sidekick.releaseChannel})
					</p>
					<p>
						{versionInfo.project.name} @ {versionInfo.project.version}
					</p>
				</div>
			)}
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
