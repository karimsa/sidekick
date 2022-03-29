import Link from 'next/link';
import { useRouter } from 'next/router';
import classNames from 'classnames';
import { memo } from 'react';

export const Tabs: React.FC = memo(function Tabs({ children }) {
	return <ul className={'flex mb-5'}>{children}</ul>;
});

export const Tab: React.FC<{ href: string }> = memo(function Tab({
	href,
	children,
}) {
	const router = useRouter();

	return (
		<li>
			<Link href={href} passHref>
				<a
					className={classNames(
						'p-5 uppercase text-white block hover:border-b',
						{
							'border-b': router.asPath === href,
						},
					)}
				>
					{children}
				</a>
			</Link>
		</li>
	);
});

export const TabView: React.FC<{ href: string }> = memo(function TabView({
	href,
	children,
}) {
	const router = useRouter();
	if (router.asPath === href) {
		return <>{children}</>;
	}
	return null;
});
