import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const recorder = {
        isRecording: false,
        uri: 'dictation.webm',
        prepareToRecordAsync: vi.fn(async () => undefined),
        record: vi.fn(),
        stop: vi.fn(async () => undefined),
    };
    return {
        recorder,
        permission: vi.fn(async () => ({ granted: true, canAskAgain: true })),
        permissionAlert: vi.fn(),
        readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
        transcribe: vi.fn(),
        credentials: { token: 'account-token', secret: 'account-secret' },
        machine: null as { active: boolean } | null,
        localVoiceStatus: vi.fn(),
        startLocalVoiceUpload: vi.fn(),
        uploadLocalVoiceChunk: vi.fn(),
        startLocalVoiceTranscription: vi.fn(),
        localVoiceOperation: vi.fn(),
        cancelLocalVoiceOperation: vi.fn(),
        releaseLocalVoiceOperation: vi.fn(),
    };
});

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-audio', () => ({
    RecordingPresets: { HIGH_QUALITY: {} },
    useAudioRecorder: () => mocks.recorder,
}));
vi.mock('@/utils/microphonePermissions', () => ({
    requestMicrophonePermission: mocks.permission,
    showMicrophonePermissionDeniedAlert: mocks.permissionAlert,
}));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: mocks.readFileBytes }));
vi.mock('@/sync/apiVoice', () => ({ transcribeVoiceInput: mocks.transcribe }));
vi.mock('@/sync/storage', () => ({ useMachine: () => mocks.machine }));
vi.mock('@/sync/localVoice', () => ({
    cancelLocalVoiceOperation: mocks.cancelLocalVoiceOperation,
    localVoiceOperation: mocks.localVoiceOperation,
    releaseLocalVoiceOperation: mocks.releaseLocalVoiceOperation,
    localVoiceStatus: mocks.localVoiceStatus,
    startLocalVoiceTranscription: mocks.startLocalVoiceTranscription,
    startLocalVoiceUpload: mocks.startLocalVoiceUpload,
    uploadLocalVoiceChunk: mocks.uploadLocalVoiceChunk,
}));
vi.mock('@/sync/sync', () => ({ sync: { getCredentials: () => mocks.credentials } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { useVoiceDictation } from './useVoiceDictation';

type DictationController = ReturnType<typeof useVoiceDictation>;

describe('useVoiceDictation', () => {
    const originalConsoleError = console.error;
    let renderer: ReactTestRenderer;
    let current: DictationController;
    let transcripts: string[];
    let providers = { localReady: false, localMachineId: null as string | null, cloudKeyConfigured: true };

    function Harness() {
        current = useVoiceDictation((text) => transcripts.push(text), providers);
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
        mocks.recorder.isRecording = false;
        mocks.recorder.uri = 'dictation.webm';
        mocks.recorder.record.mockImplementation(() => {
            mocks.recorder.isRecording = true;
        });
        mocks.recorder.stop.mockImplementation(async () => {
            mocks.recorder.isRecording = false;
        });
        mocks.permission.mockResolvedValue({ granted: true, canAskAgain: true });
        mocks.cancelLocalVoiceOperation.mockResolvedValue({ ok: true });
        mocks.releaseLocalVoiceOperation.mockResolvedValue({ ok: true });
        mocks.machine = null;
        providers = { localReady: false, localMachineId: null, cloudKeyConfigured: true };
        transcripts = [];
        act(() => {
            renderer = create(React.createElement(Harness));
        });
    });

    it('starts and cancels recording through the dedicated dictation controller', async () => {
        await act(async () => {
            current.toggle();
            await Promise.resolve();
        });

        expect(current.phase).toBe('recording');
        expect(mocks.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
        expect(mocks.recorder.record).toHaveBeenCalledOnce();

        act(() => current.cancel());
        expect(current.phase).toBe('idle');
        expect(mocks.recorder.stop).toHaveBeenCalledOnce();
        expect(mocks.transcribe).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });

    it('finishes, transcribes, reports errors, and retries the same captured audio', async () => {
        let rejectFirst!: (error: Error) => void;
        mocks.transcribe.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => {
            rejectFirst = reject;
        }));

        await act(async () => {
            current.toggle();
            await Promise.resolve();
        });
        await act(async () => {
            current.toggle();
            await Promise.resolve();
        });

        expect(current.phase).toBe('transcribing');
        expect(mocks.readFileBytes).toHaveBeenCalledWith('dictation.webm');
        expect(mocks.transcribe).toHaveBeenCalledWith(
            mocks.credentials,
            new Uint8Array([1, 2, 3]),
            'audio/webm',
        );

        await act(async () => {
            rejectFirst(new Error('OpenAI transcription failed'));
            await Promise.resolve();
        });
        expect(current.phase).toBe('error');
        expect(current.error).toBe('OpenAI transcription failed');
        expect(current.canRetry).toBe(true);
        expect(transcripts).toEqual([]);

        mocks.transcribe.mockResolvedValueOnce('dictated words');
        await act(async () => {
            current.retry();
            await Promise.resolve();
        });
        expect(current.phase).toBe('idle');
        expect(current.error).toBeNull();
        expect(current.canRetry).toBe(false);
        expect(transcripts).toEqual(['dictated words']);
        expect(mocks.transcribe).toHaveBeenCalledTimes(2);

        act(() => renderer.unmount());
    });

    it('keeps a denied microphone permission in the dictation error state', async () => {
        mocks.permission.mockResolvedValueOnce({ granted: false, canAskAgain: false });

        await act(async () => {
            current.toggle();
            await Promise.resolve();
        });

        expect(current.phase).toBe('error');
        expect(current.canRetry).toBe(false);
        expect(mocks.permissionAlert).toHaveBeenCalledWith(false);
        expect(mocks.recorder.record).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });

    it('uses a ready local engine when no cloud key is configured', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: false };
        mocks.machine = { active: true };
        mocks.startLocalVoiceUpload.mockResolvedValue({ operationId: 'local-op', nextOffset: 0 });
        mocks.uploadLocalVoiceChunk.mockResolvedValue({ nextOffset: 3 });
        mocks.startLocalVoiceTranscription.mockResolvedValue({ operationId: 'local-op', kind: 'transcribe', state: 'running' });
        mocks.localVoiceOperation.mockResolvedValue({ operationId: 'local-op', kind: 'transcribe', state: 'done', text: 'local words' });
        act(() => renderer.update(React.createElement(Harness)));
        await act(async () => {
            current.toggle();
            await Promise.resolve();
        });
        await act(async () => {
            current.toggle();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(mocks.startLocalVoiceUpload).toHaveBeenCalledWith('voice-machine', 'audio/webm', 3);
        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(transcripts).toEqual(['local words']);
        expect(mocks.releaseLocalVoiceOperation).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('falls back to configured cloud transcription only after the voice machine disconnects', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: true };
        mocks.machine = { active: true };
        mocks.startLocalVoiceUpload.mockResolvedValue({ operationId: 'local-op', nextOffset: 0 });
        mocks.uploadLocalVoiceChunk.mockImplementation(async () => {
            mocks.machine!.active = false;
            throw new Error('machine disconnected');
        });
        mocks.localVoiceStatus.mockRejectedValue(new Error('machine disconnected'));
        mocks.transcribe.mockResolvedValue('cloud words');
        act(() => renderer.update(React.createElement(Harness)));
        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mocks.localVoiceStatus).toHaveBeenCalled();
        expect(current.error).toBeNull();
        expect(mocks.transcribe).toHaveBeenCalledOnce();
        expect(mocks.cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'local-op');
        expect(mocks.releaseLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'local-op');
        expect(transcripts).toEqual(['cloud words']);
        act(() => renderer.unmount());
    });

    it('falls back once when the machine disconnects during upload-start before an operation id is returned', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: true };
        mocks.machine = { active: true };
        mocks.startLocalVoiceUpload.mockRejectedValue(new Error('machine disconnected during upload-start'));
        mocks.localVoiceStatus.mockRejectedValue(new Error('machine disconnected'));
        mocks.transcribe.mockResolvedValue('cloud words');
        act(() => renderer.update(React.createElement(Harness)));

        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await new Promise((resolve) => setTimeout(resolve, 0)); });

        expect(mocks.startLocalVoiceUpload).toHaveBeenCalledOnce();
        expect(mocks.localVoiceStatus).toHaveBeenCalledOnce();
        expect(mocks.transcribe).toHaveBeenCalledOnce();
        expect(transcripts).toEqual(['cloud words']);
        act(() => renderer.unmount());
    });

    it('keeps local model errors retryable without silently switching to cloud transcription', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: true };
        mocks.machine = { active: true };
        mocks.startLocalVoiceUpload.mockResolvedValue({ operationId: 'local-op', nextOffset: 0 });
        mocks.uploadLocalVoiceChunk.mockResolvedValue({ nextOffset: 3 });
        mocks.startLocalVoiceTranscription.mockResolvedValue({ operationId: 'local-op', kind: 'transcribe', state: 'running' });
        mocks.localVoiceOperation
            .mockResolvedValueOnce({ operationId: 'local-op', kind: 'transcribe', state: 'error', error: 'MLX model error' })
            .mockResolvedValueOnce({ operationId: 'local-op', kind: 'transcribe', state: 'done', text: 'retried local words' });
        mocks.localVoiceStatus.mockResolvedValue({ stt: { state: 'ready' } });
        mocks.transcribe.mockResolvedValue('cloud words');
        act(() => renderer.update(React.createElement(Harness)));

        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(current.phase).toBe('error');
        expect(current.error).toBe('MLX model error');
        expect(current.canRetry).toBe(true);
        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(mocks.cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'local-op');

        await act(async () => { current.retry(); await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(current.phase).toBe('idle');
        expect(transcripts).toEqual(['retried local words']);
        expect(mocks.transcribe).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('cancels the daemon operation when dictation is cancelled during local inference', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: false };
        mocks.machine = { active: true };
        mocks.startLocalVoiceUpload.mockResolvedValue({ operationId: 'cancel-op', nextOffset: 0 });
        mocks.uploadLocalVoiceChunk.mockResolvedValue({ nextOffset: 3 });
        mocks.startLocalVoiceTranscription.mockResolvedValue({ operationId: 'cancel-op', kind: 'transcribe', state: 'running' });
        let finishOperation!: (operation: any) => void;
        mocks.localVoiceOperation.mockImplementationOnce(() => new Promise((resolve) => { finishOperation = resolve; }));
        act(() => renderer.update(React.createElement(Harness)));

        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(current.phase).toBe('transcribing');
        act(() => current.cancel());
        expect(current.phase).toBe('idle');
        expect(mocks.cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'cancel-op');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mocks.releaseLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'cancel-op');
        finishOperation({ operationId: 'cancel-op', kind: 'transcribe', state: 'done', text: 'must not append' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(transcripts).toEqual([]);
        act(() => renderer.unmount());
    });

    it('cancels a local upload that returns after the Human cancels', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: true };
        mocks.machine = { active: true };
        let returnUpload!: (value: { operationId: string; nextOffset: number }) => void;
        mocks.startLocalVoiceUpload.mockImplementationOnce(() => new Promise((resolve) => { returnUpload = resolve; }));
        act(() => renderer.update(React.createElement(Harness)));

        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await Promise.resolve(); });
        expect(mocks.startLocalVoiceUpload).toHaveBeenCalledOnce();
        act(() => current.cancel());
        returnUpload({ operationId: 'late-upload-op', nextOffset: 0 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        expect(mocks.cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'late-upload-op');
        expect(mocks.releaseLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'late-upload-op');
        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(transcripts).toEqual([]);
        act(() => renderer.unmount());
    });

    it('cancels and ignores a cloud transcription that resolves after cancellation', async () => {
        providers = { localReady: false, localMachineId: null, cloudKeyConfigured: true };
        let finishCloud!: (value: string) => void;
        mocks.transcribe.mockImplementationOnce(() => new Promise((resolve) => { finishCloud = resolve; }));
        act(() => renderer.update(React.createElement(Harness)));

        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await Promise.resolve(); });
        expect(current.phase).toBe('transcribing');
        act(() => current.cancel());
        finishCloud('must not append');
        await act(async () => { await Promise.resolve(); });

        expect(transcripts).toEqual([]);
        expect(current.phase).toBe('idle');
        act(() => renderer.unmount());
    });

    it('cancels and releases an active daemon operation when the hook unmounts', async () => {
        providers = { localReady: true, localMachineId: 'voice-machine', cloudKeyConfigured: false };
        mocks.machine = { active: true };
        mocks.startLocalVoiceUpload.mockResolvedValue({ operationId: 'unmount-op', nextOffset: 0 });
        mocks.uploadLocalVoiceChunk.mockResolvedValue({ nextOffset: 3 });
        mocks.startLocalVoiceTranscription.mockResolvedValue({ operationId: 'unmount-op', kind: 'transcribe', state: 'running' });
        let finishOperation!: (operation: any) => void;
        mocks.localVoiceOperation.mockImplementationOnce(() => new Promise((resolve) => { finishOperation = resolve; }));
        act(() => renderer.update(React.createElement(Harness)));

        await act(async () => { current.toggle(); await Promise.resolve(); });
        await act(async () => { current.toggle(); await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mocks.localVoiceOperation).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
        expect(mocks.cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'unmount-op');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mocks.releaseLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'unmount-op');
        finishOperation({ operationId: 'unmount-op', kind: 'transcribe', state: 'done', text: 'must not append' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(transcripts).toEqual([]);
    });
});
