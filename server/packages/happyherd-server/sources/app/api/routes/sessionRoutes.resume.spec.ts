import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Fastify } from '../types';

const {
    findFirstMock,
    resumeSessionUpdatesMock,
} = vi.hoisted(() => ({
    findFirstMock: vi.fn(),
    resumeSessionUpdatesMock: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: {
        session: {
            findFirst: findFirstMock,
        },
    },
}));
vi.mock('@/app/presence/sessionCache', () => ({
    activityCache: {
        resumeSessionUpdates: resumeSessionUpdatesMock,
    },
}));
vi.mock('@/app/events/eventRouter', () => ({
    eventRouter: {},
    buildNewSessionUpdate: vi.fn(),
    buildSessionActivityEphemeral: vi.fn(),
}));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: vi.fn() }));
vi.mock('@/app/session/sessionDelete', () => ({ sessionDelete: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/utils/randomKeyNaked', () => ({ randomKeyNaked: vi.fn() }));

import { sessionRoutes } from './sessionRoutes';

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        request.userId = userId;
    });
    sessionRoutes(typed);
    await typed.ready();
    return typed;
}

describe('POST /v1/sessions/:sessionId/resume', () => {
    let app: Fastify;

    beforeEach(() => {
        findFirstMock.mockReset();
        resumeSessionUpdatesMock.mockReset();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it('lifts heartbeat suppression for an exact account-owned session', async () => {
        findFirstMock.mockResolvedValue({ id: 'session-1' });
        app = await createApp();

        const response = await app.inject({
            method: 'POST',
            url: '/v1/sessions/session-1/resume',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true });
        expect(findFirstMock).toHaveBeenCalledWith({
            where: { id: 'session-1', accountId: 'user-1' },
            select: { id: true },
        });
        expect(resumeSessionUpdatesMock).toHaveBeenCalledWith('session-1');
    });

    it('does not lift suppression when the session is not owned by the account', async () => {
        findFirstMock.mockResolvedValue(null);
        app = await createApp();

        const response = await app.inject({
            method: 'POST',
            url: '/v1/sessions/session-1/resume',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: 'Session not found' });
        expect(resumeSessionUpdatesMock).not.toHaveBeenCalled();
    });
});
