import * as React from 'react';
import { useEffect, useMemo } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, PackageIcon, ToolsIcon } from '@primer/octicons-react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import classNames from 'classnames';

// import { InboxItems } from './InboxItems';
import { useLocalState } from '../hooks/useLocalState';
import { useExtensions } from '../hooks/useExtensions';

export const Sidebar: React.FC<{ isOpen: boolean; setOpen(open: boolean): void }> = ({ isOpen, setOpen }) => {
    const router = useRouter();
    const { extensions } = useExtensions();

    const links = useMemo(
        () => [
            {
                icon: <PackageIcon />,
                href: '/servers',
                label: 'Dev Servers'
            },
            ...(extensions ?? []).map(extension => ({
                icon: <span style={{ fill: 'white' }} dangerouslySetInnerHTML={{ __html: extension.icon }} />,
                href: `/extensions/${extension.id}`,
                label: extension.config.title
            })),
            {
                icon: <ToolsIcon />,
                href: '/settings',
                label: 'Settings'
            }
        ],
        [extensions]
    );

    useEffect(() => {
        for (const { href } of links) {
            router.prefetch(href);
        }
    }, [links, router]);

    return (
        <div className={'flex-initial bg-slate-900 text-white'}>
            <ul>
                {links.map(({ icon, href, label }) => (
                    <li key={href}>
                        <Link href={href} passHref>
                            <a
                                className={classNames('flex items-center p-5 hover:bg-slate-700', {
                                    'bg-slate-800': href === router.pathname
                                })}
                            >
                                <span className={classNames('text-lg flex items-center', isOpen && 'pr-5')}>
                                    {icon}
                                </span>
                                {isOpen && <span className={'text-lg'}>{label}</span>}
                            </a>
                        </Link>
                    </li>
                ))}
                <li className={classNames('p-5 hover:bg-slate-700')}>
                    <a
                        className={'inline-flex items-center'}
                        href={'#'}
                        onClick={evt => {
                            evt.preventDefault();
                            setOpen(!isOpen);
                        }}
                    >
                        <span className={classNames('text-lg flex items-center', isOpen && 'pr-5')}>
                            {isOpen ? <ArrowLeftIcon /> : <ArrowRightIcon />}
                        </span>
                        {isOpen && <span className={'text-lg'}>Close sidebar</span>}
                    </a>
                </li>
            </ul>
        </div>
    );
};

export function withSidebar<T>(Main: React.FC<T>): React.FC<T> {
    return function SidebarWrappedComponent(props: T) {
        const [isOpen = true, setOpen] = useLocalState('sidebarOpen', Boolean);

        return (
            <>
                <Sidebar isOpen={isOpen} setOpen={setOpen} />
                <main className={'flex flex-col flex-auto p-5 bg-slate-700'}>
                    <div className={'w-full d-flex flex-initial'}>{/*    <InboxItems />*/}</div>

                    <Main {...props} />
                </main>
            </>
        );
    };
}
