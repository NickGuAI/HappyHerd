import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const { dbMock, callbacks, emitUpdate } = vi.hoisted(() => {
    const items: any[] = [];
    let counter = 0;
    return {
        callbacks: [] as Array<() => void>,
        emitUpdate: vi.fn(),
        dbMock: {
            items,
            machine: { findFirst: vi.fn(async ({ where }: any) => where.id === 'machine' && where.accountId === 'owner' ? { id: 'machine' } : null) },
            account: { update: vi.fn(async () => ({ feedSeq: ++counter })) },
            userFeedItem: {
                findUnique: vi.fn(async ({ where }: any) => items.find(item => item.userId === where.userId_repeatKey.userId && item.repeatKey === where.userId_repeatKey.repeatKey) ?? null),
                deleteMany: vi.fn(async () => ({})),
                create: vi.fn(async ({ data }: any) => {
                    const item = { ...data, id: `feed-${data.counter}`, createdAt: new Date() };
                    items.push(item);
                    return item;
                }),
                findMany: vi.fn(async () => items)
            }
        }
    };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({
    inTx: async (fn: any) => {
        const result = await fn(dbMock);
        for (const callback of callbacks.splice(0)) await callback();
        return result;
    },
    afterTx: (_tx: any, callback: () => void) => callbacks.push(callback)
}));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: async () => 1 }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: { emitUpdate }, buildNewFeedPostUpdate: (item: any) => item }));

import { feedRoutes } from './feedRoutes';

async function createApp() {
    const app = fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: any, reply: any) => {
        if (!request.headers.authorization) return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = request.headers.authorization;
    });
    feedRoutes(app as Fastify);
    await app.ready();
    return app;
}

const payload = { machineId: 'machine', automationId: 'automation', automationName: 'Nightly job', runId: 'run-1' };

describe('automation blocked feed notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.items.length = 0;
        callbacks.length = 0;
    });

    it('requires authentication', async () => {
        const app = await createApp();
        const response = await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', payload });
        expect(response.statusCode).toBe(401);
        expect(dbMock.userFeedItem.create).not.toHaveBeenCalled();
        await app.close();
    });

    it('rejects a machine belonging to another account', async () => {
        const app = await createApp();
        const response = await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', headers: { authorization: 'other' }, payload });
        expect(response.statusCode).toBe(404);
        expect(dbMock.machine.findFirst).toHaveBeenCalledWith({ where: { id: 'machine', accountId: 'other' }, select: { id: true } });
        expect(dbMock.userFeedItem.create).not.toHaveBeenCalled();
        await app.close();
    });

    it('persists one feed item and emits once across repeated deliveries', async () => {
        const app = await createApp();
        const request = { method: 'POST' as const, url: '/v1/feed/automation-blocked', headers: { authorization: 'owner' }, payload };
        expect((await app.inject(request)).statusCode).toBe(200);
        const original = { ...dbMock.items[0] };
        expect((await app.inject(request)).json()).toEqual({ ok: true });
        expect(dbMock.items).toEqual([original]);
        expect(dbMock.account.update).toHaveBeenCalledTimes(1);
        expect(emitUpdate).toHaveBeenCalledTimes(1);
        expect(original.body).toEqual({ kind: 'automation_blocked', ...payload });
        const feed = await app.inject({ method: 'GET', url: '/v1/feed', headers: request.headers });
        expect(feed.statusCode).toBe(200);
        expect(feed.json().items[0].body).toEqual(original.body);
        await app.close();
    });

    it('creates a new notification for a new blocking run', async () => {
        const app = await createApp();
        for (const runId of ['run-1', 'run-2']) {
            expect((await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', headers: { authorization: 'owner' }, payload: { ...payload, runId } })).statusCode).toBe(200);
        }
        expect(dbMock.items).toHaveLength(2);
        expect(emitUpdate).toHaveBeenCalledTimes(2);
        await app.close();
    });

    it('rejects incomplete episode identifiers', async () => {
        const app = await createApp();
        const response = await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', headers: { authorization: 'owner' }, payload: { ...payload, runId: '' } });
        expect(response.statusCode).toBe(400);
        expect(dbMock.userFeedItem.create).not.toHaveBeenCalled();
        await app.close();
    });
});
