import * as React from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import Head from 'next/head';
import toast from 'react-hot-toast';

import { withSidebar } from '../components/Sidebar';
import { useQueryInvalidator, useRpcQuery } from '../hooks/useQuery';
import { getConfig, updateConfig } from './api/config';
import { useRpcMutation } from '../hooks/useMutation';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';

export default withSidebar(function Settings() {
    const monaco = useMonaco();
    React.useEffect(() => {
        if (monaco) {
            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                allowComments: true
            });
        }
    }, [monaco]);

    // Load config
    const { data: configOriginal, error: errLoadingConfig } = useRpcQuery(getConfig, {});
    const configOriginalJSON = React.useMemo(() => JSON.stringify(configOriginal, null, '\t'), [configOriginal]);

    // Reset updates when config is loaded
    const [configUpdates, setConfigUpdates] = React.useState<string>('{}');
    React.useEffect(() => {
        if (configOriginalJSON) {
            setConfigUpdates(configOriginalJSON);
        }
    }, [configOriginalJSON]);

    const onDiffEditorMount = React.useCallback(
        editor => {
            editor.getModifiedEditor().onDidChangeModelContent(function () {
                setConfigUpdates(editor.getModifiedEditor().getValue());
            });
        },
        [setConfigUpdates]
    );
    const onEditorMount = React.useCallback(
        editor => {
            editor.onDidChangeModelContent(function () {
                setConfigUpdates(editor.getValue());
            });
        },
        [setConfigUpdates]
    );

    const invalidateQueries = useQueryInvalidator();
    const {
        mutate: performUpdate,
        error: errUpdatingConfig,
        isLoading: isUpdating
    } = useRpcMutation(updateConfig, {
        onSuccess: () => {
            toast.success('Settings updated successfully');
            invalidateQueries(getConfig);
        }
    });

    const [showDiff, setShowDiff] = React.useState(false);

    return (
        <>
            <Head>
                <title>Settings | Sidekick</title>
            </Head>

            <div className={'flex-auto'}>
                <div className={'bg-slate-900 rounded p-5 w-full-gah h-full flex flex-col'}>
                    <h1 className={'text-xl font-bold mb-5 text-white'}>Settings</h1>

                    {errLoadingConfig && (
                        <AlertCard title={'Failed to load settings'}>{String(errLoadingConfig)}</AlertCard>
                    )}
                    {errUpdatingConfig && (
                        <AlertCard title={'Failed to update settings'}>{String(errUpdatingConfig)}</AlertCard>
                    )}

                    {configOriginal && showDiff && (
                        <DiffEditor
                            theme={'vs-dark'}
                            height={'100%'}
                            language={'json'}
                            original={configOriginalJSON}
                            modified={configUpdates}
                            onMount={onDiffEditorMount}
                        />
                    )}

                    {configOriginal && !showDiff && (
                        <Editor
                            theme={'vs-dark'}
                            height={'100%'}
                            language={'json'}
                            defaultValue={configOriginalJSON}
                            value={configUpdates}
                            onMount={onEditorMount}
                        />
                    )}

                    {configOriginal && (
                        <div className={'w-full flex justify-end mt-5'}>
                            <Button
                                variant={'secondary'}
                                style={{ marginRight: 16 }}
                                onClick={() => setShowDiff(!showDiff)}
                            >
                                {showDiff ? 'Disable' : 'Enable'} diff view
                            </Button>

                            <Button
                                variant={'primary'}
                                className={'ml-5'}
                                loading={isUpdating}
                                onClick={() => performUpdate(JSON.parse(configUpdates))}
                            >
                                Update config
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
});
