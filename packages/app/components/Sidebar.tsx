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

// import { InboxItems } from './InboxItems';
import { useLocalState } from '../hooks/useLocalState';
import { useExtensions } from '../hooks/useExtensions';

export const Sidebar: React.FC<{
	isOpen: boolean;
	setOpen(open: boolean): void;
}> = ({ isOpen, setOpen }) => {
	const router = useRouter();
	const { extensions } = useExtensions();

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
						dangerouslySetInnerHTML={{ __html: extension.icon }}
					/>
				),
				href: `/extensions/${extension.id}`,
				label: extension.title,
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

	useEffect(() => {
		for (const { href } of links) {
			router.prefetch(href);
		}
	}, [links, router]);

	return (
		<div className={'flex-initial bg-slate-900 text-white'}>
			<ul>
				{links.map(({ icon, href, onClick, label }) => (
					<li key={label}>
						<Tooltip content={label} placement={'right'} disabled={!!isOpen}>
							<a
								href={href || '#'}
								onClick={(evt) => {
									evt.preventDefault();
									if (href) {
										router.push(href);
									} else {
										onClick();
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
	);
};

export function withSidebar<T>(Main: React.FC<T>): React.FC<T> {
	return function SidebarWrappedComponent(props: T) {
		const [isOpen, setOpen] = useLocalState('sidebarOpen', Boolean);

		return (
			<>
				{/* Avoid rendering sidebar on the server, because we need localStorage to correctly render */}
				{global.window && <Sidebar isOpen={isOpen} setOpen={setOpen} />}
				<main
					className={'flex flex-col flex-auto p-5 bg-slate-700 overflow-auto'}
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
