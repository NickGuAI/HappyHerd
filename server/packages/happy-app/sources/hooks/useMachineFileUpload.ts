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
import {
    runMachineFileUploadBatch,
    type MachineFileUploadAsset,
} from '@/utils/machineFileUploadBatch';

export type MachineFileUploadState = {
    phase: 'idle' | 'uploading' | 'cancelling' | 'cancelled' | 'complete' | 'error';
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
    const cancelRequestedRef = React.useRef(false);
    const retryAssetsRef = React.useRef<MachineFileUploadAsset[]>([]);
    const operationRef = React.useRef(0);

    const uploadAssets = React.useCallback(async (assets: MachineFileUploadAsset[]): Promise<string[]> => {
        if (runningRef.current || !options.machineId || !options.directory || assets.length === 0) return [];

        runningRef.current = true;
        cancelRequestedRef.current = false;
        retryAssetsRef.current = [];
        const operationId = operationRef.current + 1;
        operationRef.current = operationId;
        setState({ phase: 'uploading', completed: 0, total: assets.length, currentFile: null, error: null });

        try {
            const result = await runMachineFileUploadBatch({
                assets,
                isCancelled: () => cancelRequestedRef.current,
                onProgress: (completed, total, currentFile) => {
                    if (operationRef.current !== operationId) return;
                    setState({ phase: 'uploading', completed, total, currentFile, error: null });
                },
                uploadOne: async (asset) => {
                    if (typeof asset.size === 'number' && asset.size > MAX_WORKSPACE_UPLOAD_BYTES) {
                        throw new Error(t('workspace.uploadTooLarge', { file: asset.name }));
                    }
                    const bytes = await readFileBytes(asset.uri);
                    if (bytes.byteLength > MAX_WORKSPACE_UPLOAD_BYTES) {
                        throw new Error(t('workspace.uploadTooLarge', { file: asset.name }));
                    }
                    const response = await machineUploadFile(options.machineId!, {
                        directory: options.directory!,
                        fileName: asset.name,
                        content: encodeBase64(bytes),
                    });
                    if (!response.success || !response.path) {
                        throw new Error(workspaceUploadFailureMessage(asset.name, response, t('workspace.uploadFailed')));
                    }
                    return response.path;
                },
                onUploaded: (path) => {
                    if (operationRef.current === operationId) options.onUploaded?.(path);
                },
            });

            if (operationRef.current !== operationId) return result.uploaded;
            retryAssetsRef.current = result.pending;
            if (result.status === 'complete') {
                setState({
                    phase: 'complete',
                    completed: result.uploaded.length,
                    total: assets.length,
                    currentFile: null,
                    error: null,
                });
            } else if (result.status === 'cancelled') {
                setState({
                    phase: 'cancelled',
                    completed: result.uploaded.length,
                    total: assets.length,
                    currentFile: null,
                    error: null,
                });
            } else {
                setState({
                    phase: 'error',
                    completed: result.uploaded.length,
                    total: assets.length,
                    currentFile: null,
                    error: result.error instanceof Error ? result.error.message : t('workspace.uploadFailed'),
                });
            }
            return result.uploaded;
        } finally {
            runningRef.current = false;
        }
    }, [options.directory, options.machineId, options.onUploaded]);

    const pickAndUpload = React.useCallback(async (): Promise<string[]> => {
        if (runningRef.current || !options.machineId || !options.directory) return [];
        const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            multiple: true,
            copyToCacheDirectory: true,
        });
        if (result.canceled) return [];
        if (result.assets.length > MAX_WORKSPACE_UPLOAD_FILES) {
            retryAssetsRef.current = [];
            setState({
                phase: 'error',
                completed: 0,
                total: result.assets.length,
                currentFile: null,
                error: t('workspace.uploadTooMany', { count: MAX_WORKSPACE_UPLOAD_FILES }),
            });
            return [];
        }
        return uploadAssets(result.assets);
    }, [options.directory, options.machineId, uploadAssets]);

    const cancel = React.useCallback(() => {
        if (!runningRef.current) return;
        cancelRequestedRef.current = true;
        setState((current) => current.phase === 'uploading'
            ? { ...current, phase: 'cancelling' }
            : current);
    }, []);
    const retry = React.useCallback(
        () => uploadAssets([...retryAssetsRef.current]),
        [uploadAssets],
    );
    const reset = React.useCallback(() => {
        operationRef.current += 1;
        cancelRequestedRef.current = true;
        retryAssetsRef.current = [];
        setState(IDLE_STATE);
    }, []);
    return {
        state,
        pickAndUpload,
        cancel,
        retry,
        reset,
        canCancel: state.phase === 'uploading',
        canRetry: (state.phase === 'error' || state.phase === 'cancelled') && retryAssetsRef.current.length > 0,
    };
}
