import * as DocumentPicker from 'expo-document-picker';
import * as React from 'react';

import {
    MAX_WORKSPACE_UPLOAD_BYTES,
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
import { selectMachineFileUploadAssets } from '@/utils/machineFileUploadSelection';

export type MachineFileUploadState = {
    phase: 'idle' | 'uploading' | 'cancelling' | 'cancelled' | 'complete' | 'error';
    completed: number;
    total: number;
    currentFile: string | null;
    error: string | null;
    target: MachineFileUploadTarget | null;
};

export type MachineFileUploadTarget = {
    machineId: string;
    directory: string;
    label?: string;
};

const IDLE_STATE: MachineFileUploadState = {
    phase: 'idle',
    completed: 0,
    total: 0,
    currentFile: null,
    error: null,
    target: null,
};

export function useMachineFileUpload(options: {
    machineId: string | null | undefined;
    directory: string | null | undefined;
    targetLabel?: string;
    maxFiles?: number;
    onUploaded?: (path: string) => void;
}) {
    const [state, setState] = React.useState<MachineFileUploadState>(IDLE_STATE);
    const runningRef = React.useRef(false);
    const cancelRequestedRef = React.useRef(false);
    const retryAssetsRef = React.useRef<MachineFileUploadAsset[]>([]);
    const retryTargetRef = React.useRef<MachineFileUploadTarget | null>(null);
    const operationRef = React.useRef(0);

    const uploadAssets = React.useCallback(async (
        assets: MachineFileUploadAsset[],
        requestedTarget?: MachineFileUploadTarget,
    ): Promise<string[]> => {
        const target = requestedTarget ?? (options.machineId && options.directory ? {
            machineId: options.machineId,
            directory: options.directory,
            label: options.targetLabel,
        } : null);
        if (runningRef.current || !target || assets.length === 0) return [];

        runningRef.current = true;
        cancelRequestedRef.current = false;
        retryAssetsRef.current = [];
        retryTargetRef.current = target;
        const operationId = operationRef.current + 1;
        operationRef.current = operationId;
        setState({ phase: 'uploading', completed: 0, total: assets.length, currentFile: null, error: null, target });

        try {
            const result = await runMachineFileUploadBatch({
                assets,
                isCancelled: () => cancelRequestedRef.current,
                onProgress: (completed, total, currentFile) => {
                    if (operationRef.current !== operationId) return;
                    setState({ phase: 'uploading', completed, total, currentFile, error: null, target });
                },
                uploadOne: async (asset) => {
                    if (typeof asset.size === 'number' && asset.size > MAX_WORKSPACE_UPLOAD_BYTES) {
                        throw new Error(t('workspace.uploadTooLarge', { file: asset.name }));
                    }
                    const bytes = await readFileBytes(asset.uri);
                    if (bytes.byteLength > MAX_WORKSPACE_UPLOAD_BYTES) {
                        throw new Error(t('workspace.uploadTooLarge', { file: asset.name }));
                    }
                    const response = await machineUploadFile(target.machineId, {
                        directory: target.directory,
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
                    target,
                });
            } else if (result.status === 'cancelled') {
                setState({
                    phase: 'cancelled',
                    completed: result.uploaded.length,
                    total: assets.length,
                    currentFile: null,
                    error: null,
                    target,
                });
            } else {
                setState({
                    phase: 'error',
                    completed: result.uploaded.length,
                    total: assets.length,
                    currentFile: null,
                    error: result.error instanceof Error ? result.error.message : t('workspace.uploadFailed'),
                    target,
                });
            }
            return result.uploaded;
        } finally {
            runningRef.current = false;
        }
    }, [options.directory, options.machineId, options.onUploaded, options.targetLabel]);

    const pickAndUpload = React.useCallback(async (): Promise<string[]> => {
        if (runningRef.current || !options.machineId || !options.directory) return [];
        const target: MachineFileUploadTarget = {
            machineId: options.machineId,
            directory: options.directory,
            label: options.targetLabel,
        };
        const selection = await selectMachineFileUploadAssets({
            maxFiles: options.maxFiles,
            pick: () => DocumentPicker.getDocumentAsync({
                type: '*/*',
                multiple: true,
                copyToCacheDirectory: true,
            }).then((result) => ({
                cancelled: result.canceled,
                assets: result.canceled ? undefined : result.assets,
            })),
        });
        if (selection.status === 'error') {
            setState({
                phase: 'error',
                completed: 0,
                total: 0,
                currentFile: null,
                error: selection.error instanceof Error ? selection.error.message : t('workspace.uploadFailed'),
                target,
            });
            return [];
        }
        if (selection.status === 'cancelled') return [];
        if (selection.status === 'too-many') {
            retryAssetsRef.current = [];
            retryTargetRef.current = null;
            setState({
                phase: 'error',
                completed: 0,
                total: selection.selectedCount,
                currentFile: null,
                error: t('workspace.uploadTooMany', { count: selection.maxFiles }),
                target,
            });
            return [];
        }
        return uploadAssets(selection.assets, target);
    }, [options.directory, options.machineId, options.maxFiles, options.targetLabel, uploadAssets]);

    const cancel = React.useCallback(() => {
        if (!runningRef.current) return;
        cancelRequestedRef.current = true;
        setState((current) => current.phase === 'uploading'
            ? { ...current, phase: 'cancelling' }
            : current);
    }, []);
    const retry = React.useCallback(
        () => uploadAssets([...retryAssetsRef.current], retryTargetRef.current ?? undefined),
        [uploadAssets],
    );
    const reset = React.useCallback(() => {
        if (runningRef.current) {
            // Navigation changes call reset. Keep the in-flight batch on its
            // captured target; only the explicit Cancel action may stop it.
            return;
        }
        retryAssetsRef.current = [];
        retryTargetRef.current = null;
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
