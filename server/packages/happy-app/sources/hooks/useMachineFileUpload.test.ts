import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MAX_WORKSPACE_UPLOAD_BYTES } from '@slopus/happy-wire';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDocumentAsync: vi.fn(),
    machineUploadFile: vi.fn(),
    readFileBytes: vi.fn(),
    onUploaded: vi.fn(),
}));

vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.getDocumentAsync }));
vi.mock('@/sync/ops', () => ({ machineUploadFile: mocks.machineUploadFile }));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: mocks.readFileBytes }));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
}));

import { useMachineFileUpload } from './useMachineFileUpload';

type UploadController = ReturnType<typeof useMachineFileUpload>;

describe('useMachineFileUpload', () => {
    const originalConsoleError = console.error;
    let renderer: ReactTestRenderer;
    let current: UploadController;

    function Harness({
        maxFiles = 8,
        machineId = 'machine-1',
        directory = '/work/project',
        selectionKey = 'dsh',
    }: {
        maxFiles?: number;
        machineId?: string;
        directory?: string;
        selectionKey?: string;
    }) {
        current = useMachineFileUpload({
            machineId,
            directory,
            selectionKey,
            maxFiles,
            onUploaded: mocks.onUploaded,
        });
        return null;
    }

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        console.error = (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].startsWith('react-test-renderer is deprecated')) return;
            originalConsoleError(...args);
        };
    });

    afterAll(() => {
        console.error = originalConsoleError;
        delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
        mocks.machineUploadFile.mockImplementation(async (_machineId: string, request: { fileName: string }) => ({
            success: true,
            path: `/work/project/${request.fileName}`,
        }));
        act(() => {
            renderer = create(React.createElement(Harness));
        });
    });

    it('uploads already-picked photos and every existing device-file type through the same machine uploader', async () => {
        const assets = [
            { name: 'photo.jpg', uri: 'file:///photo.jpg', mimeType: 'image/jpeg', size: 3 },
            { name: 'notes.txt', uri: 'file:///notes.txt', mimeType: 'text/plain', size: 3 },
            { name: 'report.pdf', uri: 'file:///report.pdf', mimeType: 'application/pdf', size: 3 },
            { name: 'voice.m4a', uri: 'file:///voice.m4a', mimeType: 'audio/mp4', size: 3 },
            { name: 'archive.bin', uri: 'file:///archive.bin', mimeType: 'application/octet-stream', size: 3 },
        ];

        let uploaded: string[] = [];
        await act(async () => {
            uploaded = await current.uploadAssets(assets);
        });

        expect(mocks.getDocumentAsync).not.toHaveBeenCalled();
        expect(mocks.machineUploadFile).toHaveBeenCalledTimes(assets.length);
        for (const asset of assets) {
            expect(mocks.machineUploadFile).toHaveBeenCalledWith('machine-1', {
                directory: '/work/project',
                fileName: asset.name,
                content: 'AQID',
            });
        }
        expect(uploaded).toEqual(assets.map((asset) => `/work/project/${asset.name}`));
        expect(mocks.onUploaded.mock.calls.map(([path]) => path)).toEqual(uploaded);
        expect(current.state).toMatchObject({ phase: 'complete', completed: assets.length, total: assets.length });

        act(() => renderer.unmount());
    });

    it('preserves the unrestricted device-file picker', async () => {
        mocks.getDocumentAsync.mockResolvedValue({
            canceled: false,
            assets: [{ name: 'diagram.svg', uri: 'file:///diagram.svg', mimeType: 'image/svg+xml', size: 3 }],
        });

        await act(async () => {
            await current.pickAndUpload();
        });

        expect(mocks.getDocumentAsync).toHaveBeenCalledWith({
            type: '*/*',
            multiple: true,
            copyToCacheDirectory: true,
        });
        expect(mocks.onUploaded).toHaveBeenCalledWith('/work/project/diagram.svg', {
            machineId: 'machine-1',
            directory: '/work/project',
            selectionKey: 'dsh',
        });

        act(() => renderer.unmount());
    });

    it('does not create an orphan context path when selection, size, or upload fails', async () => {
        act(() => renderer.unmount());
        act(() => {
            renderer = create(React.createElement(Harness, { maxFiles: 1 }));
        });

        await act(async () => {
            await current.uploadAssets([
                { name: 'one.txt', uri: 'file:///one.txt' },
                { name: 'two.txt', uri: 'file:///two.txt' },
            ]);
        });
        expect(mocks.machineUploadFile).not.toHaveBeenCalled();
        expect(mocks.onUploaded).not.toHaveBeenCalled();
        expect(current.state.phase).toBe('error');

        act(() => renderer.unmount());
        act(() => {
            renderer = create(React.createElement(Harness));
        });
        await act(async () => {
            await current.uploadAssets([{
                name: 'too-large.bin', uri: 'file:///too-large.bin', size: MAX_WORKSPACE_UPLOAD_BYTES + 1,
            }]);
        });
        expect(mocks.machineUploadFile).not.toHaveBeenCalled();
        expect(mocks.onUploaded).not.toHaveBeenCalled();
        expect(current.state.phase).toBe('error');

        mocks.machineUploadFile.mockResolvedValueOnce({ success: false, error: 'disk full' });
        await act(async () => {
            await current.uploadAssets([{ name: 'failed.pdf', uri: 'file:///failed.pdf', size: 3 }]);
        });
        expect(mocks.onUploaded).not.toHaveBeenCalled();
        expect(current.state.phase).toBe('error');

        act(() => renderer.unmount());
    });

    it('does not stage a stale completion after the selected upload target changes', async () => {
        let resolveUpload!: (value: { success: true; path: string }) => void;
        mocks.machineUploadFile.mockImplementationOnce(() => new Promise((resolve) => {
            resolveUpload = resolve;
        }));

        let upload!: Promise<string[]>;
        await act(async () => {
            upload = current.uploadAssets([{ name: 'photo.jpg', uri: 'file:///photo.jpg', size: 3 }]);
            await vi.waitFor(() => expect(mocks.machineUploadFile).toHaveBeenCalledOnce());
        });
        act(() => {
            renderer.update(React.createElement(Harness, {
                machineId: 'machine-2',
                directory: '/work/other',
                selectionKey: 'codex',
            }));
        });
        await act(async () => {
            resolveUpload({ success: true, path: '/work/project/photo.jpg' });
            await upload;
        });

        expect(mocks.onUploaded).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ phase: 'idle', target: null });
        expect(current.canRetry).toBe(false);

        act(() => renderer.unmount());
    });

    it('does not retry or write a failed upload after its selection key changes', async () => {
        mocks.machineUploadFile.mockResolvedValueOnce({ success: false, error: 'disk full' });
        await act(async () => {
            await current.uploadAssets([{ name: 'failed.pdf', uri: 'file:///failed.pdf', size: 3 }]);
        });
        expect(current.canRetry).toBe(true);
        expect(mocks.machineUploadFile).toHaveBeenCalledOnce();

        act(() => {
            renderer.update(React.createElement(Harness, { selectionKey: 'codex' }));
        });
        await act(async () => {
            await current.retry();
        });

        expect(mocks.machineUploadFile).toHaveBeenCalledOnce();
        expect(mocks.onUploaded).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ phase: 'idle', target: null });
        expect(current.canRetry).toBe(false);

        act(() => renderer.unmount());
    });

    it('does not start an upload when the picker resolves after its target changes', async () => {
        let resolvePicker!: (value: {
            canceled: false;
            assets: Array<{ name: string; uri: string; size: number }>;
        }) => void;
        mocks.getDocumentAsync.mockImplementationOnce(() => new Promise((resolve) => {
            resolvePicker = resolve;
        }));

        let picking!: Promise<string[]>;
        act(() => {
            picking = current.pickAndUpload();
        });
        act(() => {
            renderer.update(React.createElement(Harness, {
                machineId: 'machine-2',
                directory: '/work/other',
                selectionKey: 'codex',
            }));
        });
        await act(async () => {
            resolvePicker({
                canceled: false,
                assets: [{ name: 'late.jpg', uri: 'file:///late.jpg', size: 3 }],
            });
            await picking;
        });

        expect(mocks.machineUploadFile).not.toHaveBeenCalled();
        expect(mocks.onUploaded).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ phase: 'idle', target: null });

        act(() => renderer.unmount());
    });
});
