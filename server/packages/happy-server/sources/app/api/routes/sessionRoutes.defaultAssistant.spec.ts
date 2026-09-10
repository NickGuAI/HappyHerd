import fastify from 'fastify';
import { Prisma, type Session } from '@prisma/client';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const { sessionDb, emitUpdate, buildNewSessionUpdate, allocateUserSeq, resumeSessionUpdates } = vi.hoisted(() => ({
    sessionDb: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    emitUpdate: vi.fn(), buildNewSessionUpdate: vi.fn(), allocateUserSeq: vi.fn(), resumeSessionUpdates: vi.fn(),
}));
vi.mock('@/storage/db', () => ({ db: { session: sessionDb } }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: { emitUpdate }, buildNewSessionUpdate }));
vi.mock('@/storage/seq', () => ({ allocateUserSeq }));
vi.mock('@/app/presence/sessionCache', () => ({ activityCache: { resumeSessionUpdates } }));
vi.mock('@/app/session/sessionDelete', () => ({ sessionDelete: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/utils/randomKeyNaked', () => ({ randomKeyNaked: () => 'event-id' }));

import { sessionRoutes } from './sessionRoutes';

const tag = 'happyherd-default-assistant';
const requestBody = { sessionId: 'requested-session', metadata: 'encrypted-metadata', agentState: 'encrypted-state', dataEncryptionKey: 'AQID' };
const accountTag = { accountId_tag: { accountId: 'account-a', tag } };

function session(id: string, overrides: Partial<Session> = {}): Session {
    return {
        id, accountId: 'account-a', tag, projectId: null,
        metadata: 'stored-metadata', metadataVersion: 7, agentState: 'stored-state', agentStateVersion: 9,
        dataEncryptionKey: new Uint8Array([4, 5, 6]), seq: 23, active: false,
        createdAt: new Date(100), updatedAt: new Date(200), lastActiveAt: new Date(150), ...overrides,
    };
}

function conflict() {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const accountId = request.headers['x-user-id'];
        if (typeof accountId !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = accountId;
    });
    sessionRoutes(typed);
    await typed.ready();
    return typed;
}

describe('account default Assistant session', () => {
    let app: Fastify;
    const post = (body = requestBody) => app.inject({ method: 'POST', url: '/v1/sessions/default-assistant', headers: { 'x-user-id': 'account-a' }, payload: body });
    const get = (url = '/v1/sessions/default-assistant') => app.inject({ method: 'GET', url, headers: { 'x-user-id': 'account-a' } });

    beforeEach(async () => {
        vi.resetAllMocks();
        sessionDb.findUnique.mockResolvedValue(null);
        sessionDb.findMany.mockResolvedValue([]);
        allocateUserSeq.mockResolvedValue(12);
        buildNewSessionUpdate.mockReturnValue({ t: 'new-session' });
        app = await createApp();
    });
    afterEach(async () => { await app.close(); });

    it('requires the existing authentication handler for both default-session routes', async () => {
        for (const method of ['GET', 'POST'] as const) {
            const response = await app.inject({ method, url: '/v1/sessions/default-assistant', ...(method === 'POST' ? { payload: requestBody } : {}) });
            expect(response.statusCode).toBe(401);
        }
        expect(sessionDb.findUnique).not.toHaveBeenCalled();
    });

    it('reads only the account reserved tag and returns null before first creation', async () => {
        expect((await get()).json()).toEqual({ session: null });
        expect(sessionDb.findUnique).toHaveBeenCalledWith({ where: accountTag });
        expect(sessionDb.create).not.toHaveBeenCalled();
        expect(resumeSessionUpdates).not.toHaveBeenCalled();
    });

    it('creates the prepared stable ID with encrypted fields and publishes one normal creation event', async () => {
        const created = session(requestBody.sessionId, { metadata: requestBody.metadata, agentState: requestBody.agentState, dataEncryptionKey: new Uint8Array([1, 2, 3]) });
        sessionDb.create.mockResolvedValue(created);
        const response = await post();

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ session: { id: requestBody.sessionId, metadata: requestBody.metadata, agentState: requestBody.agentState, dataEncryptionKey: 'AQID', seq: 23, active: false, activeAt: 150, createdAt: 100, updatedAt: 200, projectId: null, lastMessage: null }, isRequestedSession: true });
        expect(sessionDb.create).toHaveBeenCalledWith({ data: { id: requestBody.sessionId, accountId: 'account-a', tag, metadata: requestBody.metadata, agentState: requestBody.agentState, dataEncryptionKey: new Uint8Array([1, 2, 3]) } });
        expect(buildNewSessionUpdate).toHaveBeenCalledWith(created, 12, 'event-id');
        expect(emitUpdate).toHaveBeenCalledWith({ userId: 'account-a', payload: { t: 'new-session' }, recipientFilter: { type: 'user-scoped-only' } });
        expect(resumeSessionUpdates).not.toHaveBeenCalled();
    });

    it('returns the same row unchanged on a lost-ack retry without another creation event', async () => {
        const created = session(requestBody.sessionId);
        sessionDb.create.mockResolvedValue(created);
        await post();
        sessionDb.findUnique.mockResolvedValue(created);
        const response = await post({ ...requestBody, metadata: 'different-encrypted-metadata', dataEncryptionKey: 'BwgJ' });
        expect(response.json()).toMatchObject({ session: { id: created.id, metadata: 'stored-metadata', metadataVersion: 7, dataEncryptionKey: 'BAUG', agentState: 'stored-state', agentStateVersion: 9, seq: 23 }, isRequestedSession: true });
        expect(sessionDb.create).toHaveBeenCalledTimes(1);
        expect(sessionDb.update).not.toHaveBeenCalled();
        expect(emitUpdate).toHaveBeenCalledTimes(1);
    });

    it('returns the reserved winner even when another candidate is requested', async () => {
        sessionDb.findUnique.mockResolvedValue(session('existing-default'));
        const response = await post();
        expect(response.json()).toMatchObject({ session: { id: 'existing-default' }, isRequestedSession: false });
        expect(sessionDb.findUnique).toHaveBeenCalledTimes(1);
        expect(sessionDb.create).not.toHaveBeenCalled();
        expect(sessionDb.update).not.toHaveBeenCalled();
        expect(allocateUserSeq).not.toHaveBeenCalled();
    });

    it('adopts an account-owned session by changing only its tag and retains encrypted state and history sequence', async () => {
        const candidate = session(requestBody.sessionId, { tag: 'original-tag', projectId: 'personal-project' });
        sessionDb.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(candidate);
        sessionDb.update.mockResolvedValue({ ...candidate, tag });
        const response = await post();
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ session: { id: candidate.id, seq: 23, metadata: candidate.metadata, metadataVersion: 7, agentState: candidate.agentState, agentStateVersion: 9, dataEncryptionKey: 'BAUG', projectId: 'personal-project', active: false, activeAt: 150 }, isRequestedSession: true });
        expect(sessionDb.update).toHaveBeenCalledWith({ where: { id: candidate.id, accountId: 'account-a' }, data: { tag } });
        expect(sessionDb.create).not.toHaveBeenCalled();
        expect(emitUpdate).not.toHaveBeenCalled();
        expect(allocateUserSeq).not.toHaveBeenCalled();
        expect(resumeSessionUpdates).not.toHaveBeenCalled();
    });

    it('cannot adopt or overwrite another account session', async () => {
        sessionDb.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(session(requestBody.sessionId, { accountId: 'account-b' }));
        expect((await post()).statusCode).toBe(404);
        expect(sessionDb.update).not.toHaveBeenCalled();
        expect(sessionDb.create).not.toHaveBeenCalled();
        expect(emitUpdate).not.toHaveBeenCalled();
    });

    it.each([requestBody.sessionId, 'competing-session'])('returns one reserved winner when concurrent creation requests use %s and emits only once', async (otherId) => {
        let winner: Session | null = null;
        let initialReads = 0;
        let releaseReads = () => {};
        const bothRequestsStarted = new Promise<void>(resolve => { releaseReads = resolve; });
        sessionDb.findUnique.mockImplementation(async ({ where }) => {
            if (!where.accountId_tag) return null;
            if (initialReads < 2) {
                initialReads += 1;
                if (initialReads === 2) releaseReads();
                await bothRequestsStarted;
                return null;
            }
            return winner;
        });
        sessionDb.create.mockImplementation(async ({ data }) => {
            if (winner) throw conflict();
            winner = session(data.id);
            return winner;
        });
        const responses = await Promise.all([post(), post({ ...requestBody, sessionId: otherId })]);
        expect(responses.map(response => response.statusCode)).toEqual([200, 200]);
        expect(responses.map(response => response.json().session.id)).toEqual([requestBody.sessionId, requestBody.sessionId]);
        expect(responses.map(response => response.json().isRequestedSession)).toEqual([true, otherId === requestBody.sessionId]);
        expect(sessionDb.create).toHaveBeenCalledTimes(2);
        expect(emitUpdate).toHaveBeenCalledTimes(1);
    });

    it('loads the winner when adoption loses the reserved-tag race', async () => {
        const candidate = session(requestBody.sessionId, { tag: 'original-tag' });
        sessionDb.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(candidate).mockResolvedValueOnce(session('winner'));
        sessionDb.update.mockRejectedValue(conflict());
        const response = await post();
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ session: { id: 'winner' }, isRequestedSession: false });
        expect(emitUpdate).not.toHaveBeenCalled();
    });

    it('does not expose a conflicting ID from another account when there is no reserved winner', async () => {
        sessionDb.create.mockRejectedValue(conflict());
        const response = await post();
        expect(response.statusCode).toBe(409);
        expect(response.json()).not.toHaveProperty('session');
        expect(sessionDb.update).not.toHaveBeenCalled();
        expect(emitUpdate).not.toHaveBeenCalled();
    });

    it('keeps an older default Assistant in the latest-session response without dropping ordinary rows', async () => {
        const recent = Array.from({ length: 150 }, (_, index) => session(`recent-${index}`, { tag: `ordinary-${index}`, updatedAt: new Date(500 + index) }));
        const expectedIds = [...recent.map(row => row.id), 'old-assistant'];
        sessionDb.findMany.mockResolvedValue(recent);
        sessionDb.findUnique.mockResolvedValue(session('old-assistant'));
        const response = await get('/v1/sessions');
        expect(response.statusCode).toBe(200);
        expect(response.json().sessions).toHaveLength(151);
        expect(response.json().sessions.map((row: { id: string }) => row.id)).toEqual(expectedIds);
        expect(sessionDb.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-a' }, take: 150, orderBy: { updatedAt: 'desc' } }));
        expect(sessionDb.findUnique).toHaveBeenCalledWith({ where: accountTag });
        expect(resumeSessionUpdates).not.toHaveBeenCalled();
    });

    it('does not duplicate a default Assistant already among the latest sessions', async () => {
        const pinned = session('already-recent');
        sessionDb.findMany.mockResolvedValue([pinned]);
        sessionDb.findUnique.mockResolvedValue(pinned);
        expect((await get('/v1/sessions')).json().sessions).toHaveLength(1);
    });
});
