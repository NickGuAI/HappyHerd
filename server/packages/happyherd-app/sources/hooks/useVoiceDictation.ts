import * as React from 'react';
import { Platform } from 'react-native';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { requestMicrophonePermission, showMicrophonePermissionDeniedAlert } from '@/utils/microphonePermissions';
import { readFileBytes } from '@/utils/readFileBytes';
import { transcribeVoiceInput } from '@/sync/apiVoice';
import {
    cancelLocalVoiceOperation,
    localVoiceOperation,
    localVoiceStatus,
    releaseLocalVoiceOperation,
    startLocalVoiceTranscription,
    startLocalVoiceUpload,
    uploadLocalVoiceChunk,
} from '@/sync/localVoice';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { useMachine } from '@/sync/storage';
import { encodeBase64 } from '@/encryption/base64';
import { isMachineOnline } from '@/utils/machineUtils';

const VOICE_UPLOAD_CHUNK_BYTES = 96 * 1024;

export type VoiceDictationPhase = 'idle' | 'recording' | 'transcribing' | 'error';

type RecordedAudio = { bytes: Uint8Array; mimeType: string };
type ActiveVoiceOperation = { machineId: string; operationId: string };

function mimeTypeForRecording(uri: string): string {
    const cleanUri = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
    if (cleanUri.endsWith('.wav')) return 'audio/wav';
    if (cleanUri.endsWith('.mp3')) return 'audio/mpeg';
    if (cleanUri.endsWith('.caf')) return 'audio/caf';
    if (cleanUri.endsWith('.webm') || Platform.OS === 'web') return 'audio/webm';
    return 'audio/mp4';
}

async function cancelAndReleaseOperation(active: ActiveVoiceOperation): Promise<void> {
    await cancelLocalVoiceOperation(active.machineId, active.operationId).catch(() => undefined);
    await releaseLocalVoiceOperation(active.machineId, active.operationId).catch(() => undefined);
}

export function useVoiceDictation(onTranscript: (text: string) => void, providers: {
    localReady: boolean;
    localMachineId: string | null;
    cloudKeyConfigured: boolean;
} = { localReady: false, localMachineId: null, cloudKeyConfigured: true }) {
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const [phase, setPhase] = React.useState<VoiceDictationPhase>('idle');
    const [error, setError] = React.useState<string | null>(null);
    const lastAudio = React.useRef<RecordedAudio | null>(null);
    const mounted = React.useRef(true);
    const localMachine = useMachine(providers.localMachineId ?? '');
    const activeOperation = React.useRef<ActiveVoiceOperation | null>(null);
    const transcriptionGeneration = React.useRef(0);

    React.useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            transcriptionGeneration.current += 1;
            if (recorder.isRecording) void recorder.stop().catch(() => undefined);
            const active = activeOperation.current;
            activeOperation.current = null;
            if (active) void cancelAndReleaseOperation(active);
        };
    }, [recorder]);

    const transcribe = React.useCallback(async (audio: RecordedAudio) => {
        const requestId = ++transcriptionGeneration.current;
        const isCurrent = () => mounted.current && transcriptionGeneration.current === requestId;
        setPhase('transcribing');
        setError(null);
        try {
            const credentials = sync.getCredentials();
            if (!credentials) throw new Error(t('happyHerd.voice.signIn'));
            let transcript: string;
            const machineId = providers.localMachineId;
            const machineOnlineAtStart = Boolean(machineId && localMachine && isMachineOnline(localMachine));
            const useLocal = providers.localReady && machineOnlineAtStart && machineId !== null;
            if (useLocal && machineId) {
                try {
                    const upload = await startLocalVoiceUpload(machineId, audio.mimeType, audio.bytes.length);
                    if (!isCurrent()) {
                        await cancelAndReleaseOperation({ machineId, operationId: upload.operationId });
                        return;
                    }
                    const active = { machineId, operationId: upload.operationId };
                    activeOperation.current = active;
                    let offset = 0;
                    while (offset < audio.bytes.length) {
                        const chunk = audio.bytes.subarray(offset, Math.min(offset + VOICE_UPLOAD_CHUNK_BYTES, audio.bytes.length));
                        const response = await uploadLocalVoiceChunk(machineId, upload.operationId, offset, encodeBase64(chunk));
                        if (!isCurrent()) return;
                        if (response.nextOffset !== offset + chunk.length) throw new Error(t('happyHerd.localVoice.uploadFailed'));
                        offset = response.nextOffset;
                    }
                    await startLocalVoiceTranscription(machineId, upload.operationId);
                    if (!isCurrent()) return;
                    while (true) {
                        if (!isCurrent()) return;
                        const operation = await localVoiceOperation(machineId, upload.operationId);
                        if (!isCurrent()) return;
                        if (operation.state === 'done' && operation.text) {
                            transcript = operation.text;
                            if (activeOperation.current?.operationId === upload.operationId) activeOperation.current = null;
                            await releaseLocalVoiceOperation(machineId, upload.operationId).catch(() => undefined);
                            if (!isCurrent()) return;
                            break;
                        }
                        if (operation.state === 'done') throw new Error(t('happyHerd.voice.transcriptionFailed'));
                        if (operation.state === 'error' || operation.state === 'cancelled') {
                            throw new Error(operation.error || t('happyHerd.voice.transcriptionFailed'));
                        }
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        if (!isCurrent()) return;
                    }
                } catch (localError) {
                    if (!isCurrent()) return;

                    // Probe the current encrypted transport exactly once after a local
                    // failure. A reachable daemon's model/operation error stays local;
                    // only a failed status RPC is eligible for the single cloud fallback.
                    let statusRequestFailed = false;
                    try {
                        await localVoiceStatus(machineId);
                    } catch {
                        statusRequestFailed = true;
                    }
                    if (!isCurrent()) return;

                    const active = activeOperation.current;
                    if (active?.machineId === machineId) activeOperation.current = null;
                    if (active?.machineId === machineId) await cancelAndReleaseOperation(active);
                    if (!isCurrent()) return;

                    if (!providers.cloudKeyConfigured || !statusRequestFailed) {
                        throw localError;
                    }
                    transcript = await transcribeVoiceInput(credentials, audio.bytes, audio.mimeType);
                    if (!isCurrent()) return;
                }
            } else {
                if (!providers.cloudKeyConfigured) throw new Error(t('happyHerd.localVoice.noSpeechEngine'));
                transcript = await transcribeVoiceInput(credentials, audio.bytes, audio.mimeType);
                if (!isCurrent()) return;
            }
            if (!isCurrent()) return;
            onTranscript(transcript);
            lastAudio.current = null;
            setPhase('idle');
        } catch (nextError) {
            if (!isCurrent()) return;
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.voice.transcriptionFailed'));
            setPhase('error');
        }
    }, [localMachine, onTranscript, providers]);

    const start = React.useCallback(async () => {
        if (phase === 'recording' || phase === 'transcribing') return;
        const requestId = ++transcriptionGeneration.current;
        const isCurrent = () => mounted.current && transcriptionGeneration.current === requestId;
        setError(null);
        const permission = await requestMicrophonePermission();
        if (!isCurrent()) return;
        if (!permission.granted) {
            showMicrophonePermissionDeniedAlert(permission.canAskAgain);
            setError(t('happyHerd.voice.permissionDenied'));
            setPhase('error');
            return;
        }
        try {
            await recorder.prepareToRecordAsync();
            if (!isCurrent()) return;
            recorder.record();
            lastAudio.current = null;
            setPhase('recording');
        } catch (nextError) {
            if (!isCurrent()) return;
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.voice.startFailed'));
            setPhase('error');
        }
    }, [phase, recorder]);

    const finish = React.useCallback(async () => {
        if (phase !== 'recording') return;
        const requestId = transcriptionGeneration.current;
        const isCurrent = () => mounted.current && transcriptionGeneration.current === requestId;
        setError(null);
        setPhase('transcribing');
        try {
            await recorder.stop();
            if (!isCurrent()) return;
            const uri = recorder.uri;
            if (!uri) throw new Error(t('happyHerd.voice.noAudio'));
            const bytes = await readFileBytes(uri);
            if (!isCurrent()) return;
            const audio = { bytes, mimeType: mimeTypeForRecording(uri) };
            if (audio.bytes.length === 0) throw new Error(t('happyHerd.voice.emptyAudio'));
            lastAudio.current = audio;
            await transcribe(audio);
        } catch (nextError) {
            if (!isCurrent()) return;
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.voice.finishFailed'));
            setPhase('error');
        }
    }, [phase, recorder, transcribe]);

    const toggle = React.useCallback(() => {
        if (phase === 'recording') void finish();
        else void start();
    }, [finish, phase, start]);

    const cancel = React.useCallback(() => {
        if (phase !== 'recording' && phase !== 'transcribing') return;
        transcriptionGeneration.current += 1;
        if (phase === 'recording') void recorder.stop().catch(() => undefined);
        const active = activeOperation.current;
        activeOperation.current = null;
        if (active) void cancelAndReleaseOperation(active);
        lastAudio.current = null;
        setError(null);
        setPhase('idle');
    }, [phase, recorder]);

    const retry = React.useCallback(() => {
        if (phase !== 'error' || !lastAudio.current) return;
        void transcribe(lastAudio.current);
    }, [phase, transcribe]);

    return {
        phase,
        error,
        toggle,
        cancel,
        retry,
        canRetry: phase === 'error' && lastAudio.current !== null,
    };
}
