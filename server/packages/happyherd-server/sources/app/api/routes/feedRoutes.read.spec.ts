import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import type { Fastify } from '../types';

const fixture = vi.hoisted(() => ({
    db: undefined as unknown as PrismaClient,
    emitUpdate: vi.fn()
}));
vi.mock('@/storage/db', () => ({ get db() { return fixture.db; } }));
vi.mock('@/app/events/eventRouter', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/app/events/eventRouter')>(),
    eventRouter: { emitUpdate: fixture.emitUpdate }
}));

import { feedRoutes } from './feedRoutes';
import { feedPost } from '@/app/feed/feedPost';
import { Context } from '@/context';
import { inTx } from '@/storage/inTx';

describe('persistent Inbox read state', () => {
    let app: Fastify;
    let pg: PGlite;
    let directory: string;
    const headers = { 'x-user': 'owner' };

    async function connect() {
        pg = new PGlite(directory);
        fixture.db = new PrismaClient({ adapter: new PrismaPGlite(pg) } as any);
    }

    async function createApp() {
        const instance = fastify();
        instance.setValidatorCompiler(validatorCompiler);
        instance.setSerializerCompiler(serializerCompiler);
        const typed = instance.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
        typed.decorate('authenticate', async (request: any, reply: any) => {
            if (!request.headers['x-user']) return reply.code(401).send({ error: 'Unauthorized' });
            request.userId = request.headers['x-user'];
        });
        feedRoutes(typed);
        await typed.ready();
        return typed;
    }

    async function add(id: string, counter: number, userId = 'owner') {
        return fixture.db.userFeedItem.create({
            data: { id, userId, counter: BigInt(counter), body: { kind: 'text', text: id } }
        });
    }

    function mark(payload: object, userHeaders: Record<string, string> = headers) {
        return app.inject({ method: 'POST', url: '/v1/feed/read', headers: userHeaders, payload });
    }

    async function items(userHeaders = headers) {
        const response = await app.inject({ method: 'GET', url: '/v1/feed', headers: userHeaders });
        expect(response.statusCode).toBe(200);
        return response.json().items as Array<{ id: string; cursor: string; readAt: number | null }>;
    }

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'happyherd-feed-read-'));
        await connect();
        // Use the real additive feed migrations against an existing account table.
        await pg.exec('CREATE TABLE "Account" ("id" TEXT PRIMARY KEY, "seq" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        await pg.exec('CREATE TABLE "Machine" ("id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE)');
        for (const migration of ['20250920213557_add_user_feed', '20260930000000_add_feed_read_at']) {
            await pg.exec(await readFile(resolve(__dirname, '../../../../prisma/migrations', migration, 'migration.sql'), 'utf8'));
        }
    }, 30_000);

    beforeEach(async () => {
        fixture.emitUpdate.mockClear();
        await pg.exec('TRUNCATE "UserFeedItem", "Account" CASCADE; INSERT INTO "Account" ("id") VALUES (\'owner\'), (\'other\')');
        await pg.exec('INSERT INTO "Machine" ("id", "accountId") VALUES (\'machine\', \'owner\'), (\'foreign-machine\', \'other\')');
        app = await createApp();
    });

    afterEach(async () => { await app.close(); });
    afterAll(async () => {
        await fixture.db.$disconnect();
        await pg.close();
        await rm(directory, { recursive: true, force: true });
    });

    it('persists one read item across a database and API restart while its sibling remains unread', async () => {
        await add('first', 1);
        await add('second', 2);
        expect((await items()).map(item => item.readAt)).toEqual([null, null]);
        const response = await mark({ id: 'first' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ id: 'first', readAt: expect.any(Number) });
        await app.close();
        await fixture.db.$disconnect();
        await pg.close();
        await connect();
        app = await createApp();
        expect(await items()).toMatchObject([
            { id: 'second', cursor: '0-2', readAt: null },
            { id: 'first', cursor: '0-1', readAt: response.json().readAt }
        ]);
    });

    it('marks every item through the snapshot, including older pages, and leaves new arrivals unread', async () => {
        await fixture.db.userFeedItem.createMany({
            data: Array.from({ length: 55 }, (_, index) => ({
                id: `item-${index + 1}`, userId: 'owner', counter: BigInt(index + 1),
                body: { kind: 'text', text: 'update' }
            }))
        });
        const snapshot = await items();
        expect(snapshot).toHaveLength(50);
        await add('arrived-before-request', 56);
        const response = await mark({ through: snapshot[0].cursor });
        expect(response.statusCode).toBe(200);
        await add('arrived-after-request', 57);
        expect(await fixture.db.userFeedItem.count({ where: { userId: 'owner', readAt: { not: null } } })).toBe(55);
        expect((await items()).filter(item => item.readAt === null).map(item => item.id)).toEqual([
            'arrived-after-request', 'arrived-before-request'
        ]);
        expect(fixture.emitUpdate).toHaveBeenCalledWith({
            userId: 'owner', recipientFilter: { type: 'user-scoped-only' },
            payload: expect.objectContaining({ seq: 1, body: { t: 'feed-read', through: '0-55', readAt: response.json().readAt } })
        });
    });

    it('scopes single-item and all-item writes and GET results to the authenticated account', async () => {
        await add('owned', 1);
        await add('foreign', 1, 'other');
        expect((await mark({ id: 'foreign' })).statusCode).toBe(200);
        expect(fixture.emitUpdate).not.toHaveBeenCalled();
        expect((await mark({ through: '0-1' })).statusCode).toBe(200);
        expect(await items()).toMatchObject([{ id: 'owned', readAt: expect.any(Number) }]);
        expect(await items({ 'x-user': 'other' })).toMatchObject([{ id: 'foreign', readAt: null }]);
        expect((await mark({ id: 'owned' }, {})).statusCode).toBe(401);
        expect((await app.inject({ method: 'GET', url: '/v1/feed' })).statusCode).toBe(401);
    });

    it('treats empty, missing and already-read requests as successful no-ops without replacing read timestamps', async () => {
        expect((await mark({ through: '0-0' })).statusCode).toBe(200);
        expect((await mark({ id: 'missing' })).statusCode).toBe(200);
        expect(fixture.emitUpdate).not.toHaveBeenCalled();
        await add('one', 1);
        const first = await mark({ id: 'one' });
        expect((await mark({ id: 'one' })).statusCode).toBe(200);
        expect((await mark({ through: '0-1' })).statusCode).toBe(200);
        expect((await items())[0].readAt).toBe(first.json().readAt);
        expect(fixture.emitUpdate).toHaveBeenCalledTimes(1);
        expect(fixture.emitUpdate.mock.calls[0][0].payload.body).toEqual({ t: 'feed-read', ...first.json() });
        expect((await pg.query('SELECT "seq" FROM "Account" WHERE "id" = \'owner\'')).rows).toEqual([{ seq: 1 }]);
    });

    it.each([
        {}, { id: '' }, { id: 'one', through: '0-1' }, { through: '0-1', userId: 'other' },
        ...['1-1', '0--1', '0-1x', '0-1.5', '0-01', '0-9007199254740992'].map(through => ({ through }))
    ])('rejects ambiguous or malformed read criteria %j', async payload => {
        await add('one', 1);
        expect((await mark(payload)).statusCode).toBe(400);
        expect((await items())[0].readAt).toBeNull();
        expect(fixture.emitUpdate).not.toHaveBeenCalled();
    });

    it('keeps replacement and new feed posts unread and includes read state in new-post events', async () => {
        const first = await inTx(tx => feedPost(tx, Context.create('owner'), { kind: 'text', text: 'first' }, 'repeat'));
        await mark({ id: first.id });
        const replacement = await inTx(tx => feedPost(tx, Context.create('owner'), { kind: 'text', text: 'replacement' }, 'repeat'));
        expect(replacement).toMatchObject({ cursor: '0-2', readAt: null });
        expect(await items()).toMatchObject([{ id: replacement.id, readAt: null }]);
        // afterTx emits asynchronously; wait for the existing event delivery contract.
        await vi.waitFor(() => {
            expect(fixture.emitUpdate).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'owner', recipientFilter: { type: 'user-scoped-only' },
                payload: expect.objectContaining({ body: expect.objectContaining({ t: 'new-feed-post', id: replacement.id, repeatKey: 'repeat', readAt: null }) })
            }));
        });
    });

    it('preserves read automation notifications on repeated delivery and keeps newer runs unread after Done', async () => {
        const publish = (runId: string) => app.inject({
            method: 'POST', url: '/v1/feed/automation-blocked', headers,
            payload: { machineId: 'machine', automationId: 'automation', runId, automationName: 'Private label' }
        });
        expect((await publish('run-1')).statusCode).toBe(200);
        const first = (await items())[0];
        expect(first.readAt).toBeNull();
        const single = await mark({ id: first.id });
        expect(single.statusCode).toBe(200);
        expect((await publish('run-1')).statusCode).toBe(200);
        expect(await items()).toMatchObject([{ id: first.id, cursor: first.cursor, readAt: single.json().readAt }]);

        expect((await publish('run-2')).statusCode).toBe(200);
        const snapshot = (await items())[0];
        expect((await publish('run-3')).statusCode).toBe(200);
        const all = await mark({ through: snapshot.cursor });
        expect(all.statusCode).toBe(200);
        expect((await publish('run-2')).statusCode).toBe(200);
        const persisted = await fixture.db.userFeedItem.findMany({ where: { userId: 'owner' }, orderBy: { counter: 'desc' } });
        expect(persisted.map(item => [item.counter.toString(), item.readAt?.getTime() ?? null, item.body])).toEqual([
            ['3', null, { kind: 'automation_blocked', machineId: 'machine', automationId: 'automation', runId: 'run-3' }],
            ['2', all.json().readAt, { kind: 'automation_blocked', machineId: 'machine', automationId: 'automation', runId: 'run-2' }],
            ['1', single.json().readAt, { kind: 'automation_blocked', machineId: 'machine', automationId: 'automation', runId: 'run-1' }]
        ]);
        expect(await items({ 'x-user': 'other' })).toEqual([]);
        await vi.waitFor(() => {
            const published = fixture.emitUpdate.mock.calls.filter(([event]) => event.payload.body.t === 'new-feed-post');
            expect(published).toHaveLength(3);
            expect(published.at(-1)?.[0]).toMatchObject({
                userId: 'owner', recipientFilter: { type: 'user-scoped-only' },
                payload: { body: { t: 'new-feed-post', readAt: null,
                    repeatKey: 'automation_blocked:["machine","automation","run-3"]',
                    body: { kind: 'automation_blocked', machineId: 'machine', automationId: 'automation', runId: 'run-3' } } }
            });
            expect(published.every(([event]) => !('automationName' in event.payload.body.body))).toBe(true);
        });
    });

    it('keeps automation publishing validation and machine ownership alongside the read endpoint', async () => {
        const payload = { machineId: 'foreign-machine', automationId: 'automation', runId: 'run-1' };
        expect((await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', headers, payload })).statusCode).toBe(404);
        expect((await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', payload })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url: '/v1/feed/automation-blocked', headers,
            payload: { ...payload, machineId: 'machine', runId: '' } })).statusCode).toBe(400);
        expect(await items()).toEqual([]);
        expect(fixture.emitUpdate).not.toHaveBeenCalled();
    });
});
