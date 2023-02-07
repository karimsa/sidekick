import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
	return (
		<Html>
			<Head>
				<link
					rel={'icon'}
					href={
						'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡️</text></svg>'
					}
				/>
				<link
					rel={'stylesheet'}
					type={'text/css'}
					data-name={'vs/editor/editor.main'}
					href={
						'https://cdn.jsdelivr.net/npm/monaco-editor@0.25.2/min/vs/editor/editor.main.css'
					}
				/>
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
