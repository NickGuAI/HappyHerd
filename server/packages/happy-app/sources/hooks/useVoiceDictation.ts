import * as React from 'react';
import { Platform } from 'react-native';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { requestMicrophonePermission, showMicrophonePermissionDeniedAlert } from '@/utils/microphonePermissions';
import { readFileBytes } from '@/utils/readFileBytes';
import { transcribeVoiceInput } from '@/sync/apiVoice';
import { sync } from '@/sync/sync';
import { t } from '@/text';

export type VoiceDictationPhase = 'idle' | 'recording' | 'transcribing' | 'error';

type RecordedAudio = { bytes: Uint8Array; mimeType: string };

function mimeTypeForRecording(uri: string): string {
    const cleanUri = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
    if (cleanUri.endsWith('.wav')) return 'audio/wav';
    if (cleanUri.endsWith('.mp3')) return 'audio/mpeg';
    if (cleanUri.endsWith('.caf')) return 'audio/caf';
    if (cleanUri.endsWith('.webm') || Platform.OS === 'web') return 'audio/webm';
    return 'audio/mp4';
}

export function useVoiceDictation(onTranscript: (text: string) => void) {
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const [phase, setPhase] = React.useState<VoiceDictationPhase>('idle');
    const [error, setError] = React.useState<string | null>(null);
    const lastAudio = React.useRef<RecordedAudio | null>(null);
    const mounted = React.useRef(true);

    React.useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (recorder.isRecording) void recorder.stop().catch(() => undefined);
        };
    }, [recorder]);

    const transcribe = React.useCallback(async (audio: RecordedAudio) => {
        setPhase('transcribing');
        setError(null);
        try {
            const credentials = sync.getCredentials();
            if (!credentials) throw new Error(t('happyHerd.voice.signIn'));
            const transcript = await transcribeVoiceInput(credentials, audio.bytes, audio.mimeType);
            if (!mounted.current) return;
            onTranscript(transcript);
            lastAudio.current = null;
            setPhase('idle');
        } catch (nextError) {
            if (!mounted.current) return;
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.voice.transcriptionFailed'));
            setPhase('error');
        }
    }, [onTranscript]);

    const start = React.useCallback(async () => {
        if (phase === 'recording' || phase === 'transcribing') return;
        setError(null);
        const permission = await requestMicrophonePermission();
        if (!permission.granted) {
            showMicrophonePermissionDeniedAlert(permission.canAskAgain);
            setError(t('happyHerd.voice.permissionDenied'));
            setPhase('error');
            return;
        }
        try {
            await recorder.prepareToRecordAsync();
            recorder.record();
            lastAudio.current = null;
            setPhase('recording');
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.voice.startFailed'));
            setPhase('error');
        }
    }, [phase, recorder]);

    const finish = React.useCallback(async () => {
        if (phase !== 'recording') return;
        try {
            await recorder.stop();
            const uri = recorder.uri;
            if (!uri) throw new Error(t('happyHerd.voice.noAudio'));
            const audio = { bytes: await readFileBytes(uri), mimeType: mimeTypeForRecording(uri) };
            if (audio.bytes.length === 0) throw new Error(t('happyHerd.voice.emptyAudio'));
            lastAudio.current = audio;
            await transcribe(audio);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.voice.finishFailed'));
            setPhase('error');
        }
    }, [phase, recorder, transcribe]);

    const toggle = React.useCallback(() => {
        if (phase === 'recording') void finish();
        else void start();
    }, [finish, phase, start]);

    const cancel = React.useCallback(() => {
        if (phase !== 'recording') return;
        void recorder.stop().catch(() => undefined);
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
