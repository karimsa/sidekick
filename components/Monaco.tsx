import Editor, {
	DiffEditor,
	DiffEditorProps,
	EditorProps,
} from '@monaco-editor/react';
import * as React from 'react';

type MonacoProps =
	| ({ diff: true } & DiffEditorProps)
	| ({ diff?: false } & EditorProps);

export const Monaco: React.FC<MonacoProps> = (props) => {
	if (props.diff) {
		return (
			<div className={'rounded overflow-hidden h-full w-full'}>
				<DiffEditor
					theme={'vs-dark'}
					height={'100%'}
					language={'javascript'}
					{...props}
				/>
			</div>
		);
	}
	return (
		<div className={'rounded overflow-hidden h-full w-full max-h-screen'}>
			<Editor
				theme={'vs-dark'}
				height={'100%'}
				language={'javascript'}
				{...props}
			/>
		</div>
	);
};
