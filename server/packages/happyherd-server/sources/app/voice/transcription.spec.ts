import { describe, expect, it, vi } from 'vitest';
import {
    MAX_TRANSCRIPTION_AUDIO_BYTES,
    decodeTranscriptionAudio,
    normalizeAudioMimeType,
    resolveVoiceTranscriptionApiKey,
    transcribeVoiceInput,
} from './transcription';

describe('HappyHerd voice transcription', () => {
    it('prefers a direct key and otherwise reads a file-backed key', () => {
        expect(resolveVoiceTranscriptionApiKey({ OPENAI_API_KEY: ' direct-key ', OPENAI_API_KEY_FILE: '/ignored' }, (() => {
            throw new Error('should not read');
        }) as any)).toBe('direct-key');
        expect(resolveVoiceTranscriptionApiKey({ OPENAI_API_KEY_FILE: '/run/secrets/key' }, ((path: string) => {
            expect(path).toBe('/run/secrets/key');
            return ' file-key\n';
        }) as any)).toBe('file-key');
        expect(resolveVoiceTranscriptionApiKey({ OPENAI_API_KEY_FILE: '/missing' }, (() => {
            throw new Error('missing');
        }) as any)).toBeNull();
    });

    it('validates MIME type and payload bounds', () => {
        expect(normalizeAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
        expect(() => normalizeAudioMimeType('application/pdf')).toThrow('Unsupported audio type');
        expect(() => decodeTranscriptionAudio('')).toThrow('empty');
        expect(() => decodeTranscriptionAudio(Buffer.alloc(MAX_TRANSCRIPTION_AUDIO_BYTES + 1).toString('base64'))).toThrow('larger than 15 MiB');
    });

    it('sends the transcription request to OpenAI without exposing the key', async () => {
        const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            expect(init?.headers).toEqual({ Authorization: 'Bearer server-secret' });
            const form = init?.body as unknown as FormData;
            expect(form.get('model')).toBe('gpt-4o-transcribe');
            expect(form.get('prompt')).toContain('HappyHerd');
            return new Response(JSON.stringify({ text: 'Run the TypeScript tests.' }), { status: 200 });
        });
        await expect(transcribeVoiceInput({
            audioBase64: Buffer.from('fake-webm').toString('base64'),
            mimeType: 'audio/webm',
            apiKey: 'server-secret',
            fetchImpl: fetchImpl as typeof fetch,
        })).resolves.toBe('Run the TypeScript tests.');
    });
});
