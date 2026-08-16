import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Fastify } from '../types';

const { findManyMock } = vi.hoisted(() => ({
    findManyMock: vi.fn(async (args: any) => {
        const allowed = new Set(args?.where?.vendor?.in ?? []);
        return [
            { vendor: 'openai', token: Buffer.from('openai-token') },
            { vendor: 'happyherd-voice-openai', token: Buffer.from('voice-secret') },
        ].filter((row) => allowed.has(row.vendor));
    }),
}));

vi.mock('@/storage/db', () => ({
    db: {
        serviceAccountToken: {
            findMany: findManyMock,
            findUnique: vi.fn(),
            upsert: vi.fn(),
            delete: vi.fn(),
        },
    },
}));
vi.mock('@/modules/encrypt', () => ({
    encryptString: vi.fn(),
    decryptString: vi.fn((_path: string[], token: Uint8Array) => Buffer.from(token).toString()),
}));
vi.mock('@/app/auth/auth', () => ({ auth: {} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {} }));
vi.mock('@/app/github/githubConnect', () => ({ githubConnect: vi.fn() }));
vi.mock('@/app/github/githubDisconnect', () => ({ githubDisconnect: vi.fn() }));
vi.mock('@/context', () => ({ Context: { create: vi.fn() } }));

import { connectRoutes } from './connectRoutes';

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any) => { request.userId = 'user-1'; });
    connectRoutes(typed);
    await typed.ready();
    return typed;
}

describe('generic connected-provider token listing', () => {
    let app: Fastify;
    afterEach(async () => { if (app) await app.close(); });

    it('never includes the dedicated voice transcription credential', async () => {
        app = await createApp();
        const response = await app.inject({ method: 'GET', url: '/v1/connect/tokens' });

        expect(response.statusCode).toBe(200);
        expect(findManyMock).toHaveBeenCalledWith({
            where: {
                accountId: 'user-1',
                vendor: { in: ['openai', 'anthropic', 'gemini'] },
            },
        });
        expect(response.json()).toEqual({ tokens: [{ vendor: 'openai', token: 'openai-token' }] });
        expect(response.body).not.toContain('voice-secret');
    });
});
