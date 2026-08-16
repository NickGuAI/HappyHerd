import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Fastify } from '../types';

const {
    state,
    getStatusMock,
    setKeyMock,
    removeKeyMock,
    resolveKeyMock,
    testKeyMock,
    transcribeMock,
} = vi.hoisted(() => {
    const state = { status: { configured: false, source: null as 'user' | 'deployment' | null }, key: null as string | null };
    return {
        state,
        getStatusMock: vi.fn(async () => state.status),
        setKeyMock: vi.fn(async (_userId: string, apiKey: string) => {
            state.key = apiKey;
            state.status = { configured: true, source: 'user' };
        }),
        removeKeyMock: vi.fn(async () => {
            state.key = null;
            state.status = { configured: false, source: null };
        }),
        resolveKeyMock: vi.fn(async () => state.key),
        testKeyMock: vi.fn(async () => undefined),
        transcribeMock: vi.fn(async () => 'Editable transcript'),
    };
});

vi.mock('@/app/voice/transcriptionCredentials', () => ({
    getVoiceTranscriptionKeyStatus: getStatusMock,
    setVoiceTranscriptionApiKey: setKeyMock,
    removeVoiceTranscriptionApiKey: removeKeyMock,
    resolveVoiceTranscriptionApiKeyForUser: resolveKeyMock,
    testVoiceTranscriptionApiKey: testKeyMock,
}));
vi.mock('@/app/voice/transcription', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/voice/transcription')>();
    return { ...actual, transcribeVoiceInput: transcribeMock };
});
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import { voiceRoutes } from './voiceRoutes';

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = userId;
    });
    voiceRoutes(typed);
    await typed.ready();
    return typed;
}

describe('voice transcription key routes', () => {
    let app: Fastify;
    beforeEach(() => {
        state.status = { configured: false, source: null };
        state.key = null;
        vi.clearAllMocks();
    });
    afterEach(async () => { if (app) await app.close(); });

    it('validates and stores a key but returns masked status only', async () => {
        app = await createApp();
        const response = await app.inject({
            method: 'PUT',
            url: '/v1/voice/transcription-key',
            headers: { 'x-user-id': 'user-1' },
            payload: { apiKey: 'sk-test-secret' },
        });

        expect(response.statusCode).toBe(200);
        expect(testKeyMock).toHaveBeenCalledWith('sk-test-secret');
        expect(setKeyMock).toHaveBeenCalledWith('user-1', 'sk-test-secret');
        expect(response.json()).toEqual({ configured: true, source: 'user' });
        expect(response.body).not.toContain('sk-test-secret');
    });

    it('uses the account key for transcription and reports missing configuration explicitly', async () => {
        app = await createApp();
        const missing = await app.inject({
            method: 'POST',
            url: '/v1/voice/transcriptions',
            headers: { 'x-user-id': 'user-1' },
            payload: { audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' },
        });
        expect(missing.statusCode).toBe(503);
        expect(missing.json()).toEqual({ error: 'Voice transcription is not configured' });

        state.key = 'user-key';
        const configured = await app.inject({
            method: 'POST',
            url: '/v1/voice/transcriptions',
            headers: { 'x-user-id': 'user-1' },
            payload: { audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' },
        });
        expect(configured.statusCode).toBe(200);
        expect(transcribeMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'user-key' }));
        expect(configured.json()).toEqual({ text: 'Editable transcript' });
    });

    it('removes a user key idempotently without returning secret material', async () => {
        state.key = 'user-key';
        state.status = { configured: true, source: 'user' };
        app = await createApp();
        const response = await app.inject({
            method: 'DELETE',
            url: '/v1/voice/transcription-key',
            headers: { 'x-user-id': 'user-1' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ configured: false, source: null });
        expect(response.body).not.toContain('user-key');
    });
});
