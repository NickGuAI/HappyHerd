import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useSetting } from '@/sync/storage';
import { useLocalVoiceStatus } from '@/hooks/useLocalVoiceStatus';
import { cancelLocalVoiceOperation, readLocalVoiceAudio, releaseLocalVoiceOperation, startLocalVoiceSpeech } from '@/sync/localVoice';
import { decodeBase64 } from '@/encryption/base64';
import { t } from '@/text';

let activePlayback: (() => void) | null = null;

function stopActivePlayback() {
    const stop = activePlayback;
    activePlayback = null;
    stop?.();
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function LocalVoicePlayback(props: { machineId: string | null; summary: string | null; body: string; messageId: string }) {
    const { theme } = useUnistyles();
    const enabled = useSetting('localVoiceTtsEnabled');
    const { status, online } = useLocalVoiceStatus(enabled ? props.machineId : null);
    const [playing, setPlaying] = React.useState<'summary' | 'body' | null>(null);
    const [error, setError] = React.useState(false);
    const activeRef = React.useRef(false);
    const activeMachineId = React.useRef<string | null>(null);
    const activeOwner = React.useRef<object | null>(null);
    const ownedStop = React.useRef<(() => void) | null>(null);
    const ready = Platform.OS === 'web' && enabled && online && status?.tts.state === 'ready';
    const eligibility = React.useRef({ ready, machineId: props.machineId });
    eligibility.current = { ready, machineId: props.machineId };

    const play = React.useCallback((kind: 'summary' | 'body', text: string) => {
        if (!ready || !props.machineId || !text.trim()) return;
        const AudioContextType = typeof window !== 'undefined'
            ? window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            : undefined;
        if (!AudioContextType) {
            setError(true);
            return;
        }

        const targetMachineId = props.machineId;
        stopActivePlayback();
        const owner = {};
        const context = new AudioContextType();
        // Resume synchronously in the user's click or tap so Safari keeps the
        // context unlocked while the encrypted RPC returns audio chunks.
        void context.resume().catch(() => undefined);
        const sources = new Set<AudioBufferSourceNode>();
        let cancelled = false;
        let operationId: string | null = null;
        let nextStartAt = context.currentTime;
        const isCurrent = () => !cancelled
            && eligibility.current.ready
            && eligibility.current.machineId === targetMachineId;
        activeRef.current = true;
        activeMachineId.current = targetMachineId;
        activeOwner.current = owner;
        setPlaying(kind);
        setError(false);
        const cancel = () => {
            if (cancelled) return;
            cancelled = true;
            sources.forEach((source) => {
                try { source.stop(); } catch { /* already stopped */ }
            });
            sources.clear();
            if (operationId) void cancelLocalVoiceOperation(targetMachineId, operationId).catch(() => undefined);
            void context.close().catch(() => undefined);
            if (activeOwner.current === owner) {
                activeRef.current = false;
                activeMachineId.current = null;
                activeOwner.current = null;
                ownedStop.current = null;
                setPlaying(null);
            }
        };
        ownedStop.current = cancel;
        activePlayback = cancel;

        void (async () => {
            let completed = false;
            try {
                const operation = await startLocalVoiceSpeech(targetMachineId, text);
                operationId = operation.operationId;
                if (!isCurrent()) {
                    if (cancelled) void cancelLocalVoiceOperation(targetMachineId, operationId).catch(() => undefined);
                    else cancel();
                    return;
                }
                let cursor = 0;
                while (isCurrent()) {
                    const result = await readLocalVoiceAudio(targetMachineId, operationId, cursor);
                    if (!isCurrent()) {
                        cancel();
                        break;
                    }
                    for (const chunk of result.chunks) {
                        if (!isCurrent()) {
                            cancel();
                            break;
                        }
                        const audioBytes = decodeBase64(chunk.audioBase64);
                        const audioBuffer = new ArrayBuffer(audioBytes.byteLength);
                        new Uint8Array(audioBuffer).set(audioBytes);
                        const buffer = await context.decodeAudioData(audioBuffer);
                        if (!isCurrent()) {
                            cancel();
                            break;
                        }
                        const source = context.createBufferSource();
                        source.buffer = buffer;
                        source.connect(context.destination);
                        const startAt = Math.max(nextStartAt, context.currentTime);
                        nextStartAt = startAt + buffer.duration;
                        sources.add(source);
                        source.onended = () => sources.delete(source);
                        source.start(startAt);
                    }
                    if (!isCurrent()) break;
                    cursor = result.nextCursor;
                    if (result.state === 'error' || result.state === 'cancelled') {
                        throw new Error(result.error || 'Voice playback failed');
                    }
                    // A completed synthesis may still have a final bounded batch
                    // buffered. Drain it and finish only after a terminal empty read.
                    if (result.state === 'done' && result.chunks.length === 0) {
                        completed = true;
                        break;
                    }
                    await wait(result.chunks.length === 0 ? 180 : 10);
                    if (!isCurrent()) {
                        cancel();
                        break;
                    }
                }
                while (isCurrent() && context.currentTime < nextStartAt) {
                    await wait(100);
                    if (!isCurrent()) {
                        cancel();
                        break;
                    }
                }
            } catch {
                if (isCurrent()) setError(true);
            } finally {
                if (operationId && !cancelled) {
                    if (completed) void releaseLocalVoiceOperation(targetMachineId, operationId).catch(() => undefined);
                    else void cancelLocalVoiceOperation(targetMachineId, operationId).catch(() => undefined);
                }
                if (activePlayback === cancel) activePlayback = null;
                if (!cancelled) {
                    await context.close().catch(() => undefined);
                    if (activeOwner.current === owner) {
                        activeRef.current = false;
                        activeMachineId.current = null;
                        activeOwner.current = null;
                        ownedStop.current = null;
                        setPlaying(null);
                    }
                }
            }
        })();
    }, [props.machineId, ready]);

    React.useEffect(() => {
        if (activeRef.current && (!ready || activeMachineId.current !== props.machineId)) stopActivePlayback();
    }, [props.machineId, ready]);

    React.useEffect(() => () => {
        if (activeRef.current && activePlayback === ownedStop.current) stopActivePlayback();
    }, [props.messageId]);

    if (!ready && !playing) return null;

    const button = (kind: 'summary' | 'body', label: string, text: string) => {
        const selected = playing === kind;
        return (
            <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => play(kind, text)}
                style={({ pressed }) => ({
                    alignItems: 'center',
                    flexDirection: 'row',
                    gap: 6,
                    opacity: pressed ? 0.65 : 1,
                    paddingHorizontal: 9,
                    paddingVertical: 6,
                    borderRadius: 14,
                    backgroundColor: theme.colors.surfaceSelected,
                })}
            >
                <Ionicons name={selected ? 'volume-high' : 'play'} size={15} color={theme.colors.textLink} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{label}</Text>
            </Pressable>
        );
    };

    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 8 }}>
            {ready && props.summary ? button('summary', t('happyHerd.localVoice.playSummary'), props.summary) : null}
            {ready && props.body.trim() ? button('body', t('happyHerd.localVoice.playReply'), props.body) : null}
            {playing ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('happyHerd.localVoice.stop')} onPress={stopActivePlayback} hitSlop={8}>
                    <Ionicons name="stop-circle-outline" size={20} color={theme.colors.textSecondary} />
                </Pressable>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.textDestructive, fontSize: 12 }}>{t('happyHerd.localVoice.playbackFailed')}</Text> : null}
        </View>
    );
}
