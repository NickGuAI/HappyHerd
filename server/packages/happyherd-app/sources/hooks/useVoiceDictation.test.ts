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
vi.mock('@/sync/sync', () => ({ sync: { getCredentials: () => mocks.credentials } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { useVoiceDictation } from './useVoiceDictation';

type DictationController = ReturnType<typeof useVoiceDictation>;

describe('useVoiceDictation', () => {
    const originalConsoleError = console.error;
    let renderer: ReactTestRenderer;
    let current: DictationController;
    let transcripts: string[];

    function Harness() {
        current = useVoiceDictation((text) => transcripts.push(text));
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
});
