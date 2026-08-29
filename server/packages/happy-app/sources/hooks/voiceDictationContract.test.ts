import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '@/encryption/base64';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://happyherd.example' }));
vi.mock('@/sync/apiSocket', () => ({ getHappyClientId: () => 'web-test' }));
vi.mock('@/config', () => ({ config: { elevenLabsAgentId: null } }));

import { transcribeVoiceInput } from '@/sync/apiVoice';

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

describe('voice dictation transport contract', () => {
    it('encodes binary audio without modifying a composer draft', () => {
        const draft = 'keep this draft';
        const audio = new Uint8Array([0, 1, 2, 250, 255]);
        expect(encodeBase64(audio)).toBe('AAEC+v8=');
        expect(draft).toBe('keep this draft');
    });

    it('posts dictation audio only to the OpenAI transcription route', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '  dictated text  ' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(transcribeVoiceInput(
            { token: 'account-token', secret: 'account-secret' },
            new Uint8Array([1, 2, 3]),
            'audio/webm',
        )).resolves.toBe('dictated text');

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://happyherd.example/v1/voice/transcriptions');
        expect(url).not.toContain('/v1/voice/conversations');
        expect(request).toMatchObject({ method: 'POST' });
        expect(JSON.parse(String(request.body))).toEqual({
            audioBase64: 'AQID',
            language: 'en',
            mimeType: 'audio/webm',
        });
    });
});
