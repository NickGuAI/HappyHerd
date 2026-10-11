import { describe, expect, it } from 'vitest';
import {
    LocalVoiceStatusSchema,
    VoiceOperationSchema,
    VoiceReadResultSchema,
    VoiceUploadChunkRequestSchema,
    VOICE_RPC_METHODS,
} from './localVoice';

describe('local voice wire contracts', () => {
    it('accepts explicit install readiness and asynchronous operation states', () => {
        expect(LocalVoiceStatusSchema.parse({
            stt: { state: 'ready' },
            tts: { state: 'unsupported', error: 'Requires Apple Silicon' },
        }).tts.state).toBe('unsupported');
        expect(VoiceOperationSchema.parse({ operationId: 'opaque', kind: 'install', state: 'running', progress: 'Downloading model' }).state).toBe('running');
    });

    it('keeps chunk reads ordered, replayable and bounded by the transport contract', () => {
        const response = VoiceReadResultSchema.parse({ state: 'running', nextCursor: 1, chunks: [{
            index: 0,
            audioBase64: 'UklGRg==',
            mimeType: 'audio/wav',
            sampleRate: 24_000,
        }] });
        expect(response.chunks[0].index).toBe(0);
        expect(VOICE_RPC_METHODS.read).toBe('happyherd-voice-read');
        expect(VoiceUploadChunkRequestSchema.safeParse({ operationId: 'upload', offset: 0, audioBase64: 'x'.repeat(256 * 1024 + 1) }).success).toBe(false);
    });
});
