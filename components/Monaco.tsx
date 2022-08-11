import Editor, {
	DiffEditor,
	DiffEditorProps,
	EditorProps,
} from '@monaco-editor/react';
import * as React from 'react';

type ModifiedDiffEditorProps = Omit<
	DiffEditorProps,
	'original' | 'modified'
> & {
	// Uses defaultValue as the original in diff editor
	defaultValue: string;
	// Uses value as the modified in diff editor
	value: string;
};

type MonacoProps =
	| ({ diff: true } & ModifiedDiffEditorProps)
	| ({ diff?: false } & EditorProps);

export const Monaco: React.FC<MonacoProps> = (props) => {
	if (props.diff) {
		return (
			<div className={'rounded overflow-hidden h-full w-full'}>
				<DiffEditor
					theme={'vs-dark'}
					height={'100%'}
					original={props.defaultValue}
					modified={props.value}
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
