import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, dbMock, encryptStringMock, decryptStringMock } = vi.hoisted(() => {
    const state = {
        row: null as null | { id: string; token: Uint8Array; vendor: string },
    };
    const dbMock = {
        serviceAccountToken: {
            findUnique: vi.fn(async (args: any) => {
                if (!state.row) return null;
                return args?.select?.id ? { id: state.row.id } : { token: state.row.token };
            }),
            upsert: vi.fn(async (args: any) => {
                state.row = {
                    id: 'voice-token',
                    token: args.update.token,
                    vendor: args.create.vendor,
                };
                return state.row;
            }),
            deleteMany: vi.fn(async () => {
                const count = state.row ? 1 : 0;
                state.row = null;
                return { count };
            }),
        },
    };
    const encryptStringMock = vi.fn((_path: string[], value: string) => Buffer.from(`encrypted:${value}`));
    const decryptStringMock = vi.fn((_path: string[], value: Uint8Array) => Buffer.from(value).toString().replace('encrypted:', ''));
    return { state, dbMock, encryptStringMock, decryptStringMock };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/modules/encrypt', () => ({
    encryptString: encryptStringMock,
    decryptString: decryptStringMock,
}));

import {
    VOICE_TRANSCRIPTION_TOKEN_VENDOR,
    getVoiceTranscriptionKeyStatus,
    removeVoiceTranscriptionApiKey,
    resolveVoiceTranscriptionApiKeyForUser,
    setVoiceTranscriptionApiKey,
    testVoiceTranscriptionApiKey,
} from './transcriptionCredentials';

describe('per-account voice transcription credentials', () => {
    beforeEach(() => {
        state.row = null;
        vi.clearAllMocks();
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY_FILE;
    });

    it('encrypts a user key under a voice-specific path and never returns it from status', async () => {
        await setVoiceTranscriptionApiKey('user-1', '  sk-test-secret  ');

        expect(state.row?.vendor).toBe(VOICE_TRANSCRIPTION_TOKEN_VENDOR);
        expect(encryptStringMock).toHaveBeenCalledWith(
            ['user', 'user-1', 'voice', 'openai', 'api-key'],
            'sk-test-secret',
        );
        await expect(getVoiceTranscriptionKeyStatus('user-1')).resolves.toEqual({
            configured: true,
            source: 'user',
        });
        expect(decryptStringMock).not.toHaveBeenCalled();
    });

    it('prefers the user key and falls back to the deployment key after removal', async () => {
        process.env.OPENAI_API_KEY = 'deployment-key';
        await setVoiceTranscriptionApiKey('user-1', 'user-key');
        await expect(resolveVoiceTranscriptionApiKeyForUser('user-1')).resolves.toBe('user-key');

        await removeVoiceTranscriptionApiKey('user-1');
        await expect(resolveVoiceTranscriptionApiKeyForUser('user-1')).resolves.toBe('deployment-key');
        await expect(getVoiceTranscriptionKeyStatus('user-1')).resolves.toEqual({
            configured: true,
            source: 'deployment',
        });
    });

    it('tests the key without including it in provider errors', async () => {
        const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            expect(init?.headers).toEqual({ Authorization: 'Bearer sk-test-secret' });
            return new Response('', { status: 401 });
        });

        await expect(testVoiceTranscriptionApiKey('sk-test-secret', fetchImpl as typeof fetch))
            .rejects.toThrow('OpenAI rejected this API key');
        await expect(testVoiceTranscriptionApiKey('sk-test-secret', fetchImpl as typeof fetch))
            .rejects.not.toThrow('sk-test-secret');
    });
});
