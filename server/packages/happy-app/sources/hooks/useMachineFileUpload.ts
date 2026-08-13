import * as DocumentPicker from 'expo-document-picker';
import * as React from 'react';

import {
    MAX_WORKSPACE_UPLOAD_BYTES,
    MAX_WORKSPACE_UPLOAD_FILES,
} from '@slopus/happy-wire';
import { encodeBase64 } from '@/encryption/base64';
import { machineUploadFile } from '@/sync/ops';
import { readFileBytes } from '@/utils/readFileBytes';
import { t } from '@/text';
import { workspaceUploadFailureMessage } from '@/utils/machineFileUpload';

export type MachineFileUploadState = {
    phase: 'idle' | 'uploading' | 'complete' | 'error';
    completed: number;
    total: number;
    currentFile: string | null;
    error: string | null;
};

const IDLE_STATE: MachineFileUploadState = {
    phase: 'idle',
    completed: 0,
    total: 0,
    currentFile: null,
    error: null,
};

export function useMachineFileUpload(options: {
    machineId: string | null | undefined;
    directory: string | null | undefined;
    onUploaded?: (path: string) => void;
}) {
    const [state, setState] = React.useState<MachineFileUploadState>(IDLE_STATE);
    const runningRef = React.useRef(false);

    const pickAndUpload = React.useCallback(async (): Promise<string[]> => {
        if (runningRef.current || !options.machineId || !options.directory) return [];
        const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            multiple: true,
            copyToCacheDirectory: true,
        });
        if (result.canceled) return [];
        if (result.assets.length > MAX_WORKSPACE_UPLOAD_FILES) {
            setState({
                phase: 'error',
                completed: 0,
                total: result.assets.length,
                currentFile: null,
                error: t('workspace.uploadTooMany', { count: MAX_WORKSPACE_UPLOAD_FILES }),
            });
            return [];
        }

        runningRef.current = true;
        const uploaded: string[] = [];
        setState({ phase: 'uploading', completed: 0, total: result.assets.length, currentFile: null, error: null });
        try {
            for (let index = 0; index < result.assets.length; index += 1) {
                const asset = result.assets[index];
                setState({
                    phase: 'uploading',
                    completed: index,
                    total: result.assets.length,
                    currentFile: asset.name,
                    error: null,
                });
                if (typeof asset.size === 'number' && asset.size > MAX_WORKSPACE_UPLOAD_BYTES) {
                    throw new Error(t('workspace.uploadTooLarge', { file: asset.name }));
                }
                const bytes = await readFileBytes(asset.uri);
                if (bytes.byteLength > MAX_WORKSPACE_UPLOAD_BYTES) {
                    throw new Error(t('workspace.uploadTooLarge', { file: asset.name }));
                }
                const response = await machineUploadFile(options.machineId, {
                    directory: options.directory,
                    fileName: asset.name,
                    content: encodeBase64(bytes),
                });
                if (!response.success || !response.path) {
                    throw new Error(workspaceUploadFailureMessage(asset.name, response, t('workspace.uploadFailed')));
                }
                uploaded.push(response.path);
                options.onUploaded?.(response.path);
            }
            setState({
                phase: 'complete',
                completed: uploaded.length,
                total: result.assets.length,
                currentFile: null,
                error: null,
            });
            return uploaded;
        } catch (error) {
            setState({
                phase: 'error',
                completed: uploaded.length,
                total: result.assets.length,
                currentFile: null,
                error: error instanceof Error ? error.message : t('workspace.uploadFailed'),
            });
            return uploaded;
        } finally {
            runningRef.current = false;
        }
    }, [options.directory, options.machineId, options.onUploaded]);

    const reset = React.useCallback(() => setState(IDLE_STATE), []);
    return { state, pickAndUpload, reset };
}
