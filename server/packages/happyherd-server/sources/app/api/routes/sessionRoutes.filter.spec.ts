import fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const fixture = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient }));
vi.mock('@/storage/db', () => ({ get db() { return fixture.db; } }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: { emitUpdate: vi.fn() } }));
vi.mock('@/app/presence/sessionCache', () => ({ activityCache: {} }));
vi.mock('@/app/session/sessionDelete', () => ({ sessionDelete: vi.fn() }));

import { sessionRoutes } from './sessionRoutes';

it('filters the account list by ID without changing list paging', async () => {
    const pg = new PGlite();
    fixture.db = new PrismaClient({ adapter: new PrismaPGlite(pg) } as any);
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const account = request.headers['x-user-id'];
        if (typeof account !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = account;
    });
    try {
        await pg.exec(`CREATE TABLE "Session" (
            "id" TEXT PRIMARY KEY, "tag" TEXT NOT NULL, "accountId" TEXT NOT NULL,
            "projectId" TEXT, "avatarRef" TEXT, "avatarPreview" TEXT, "avatarVersion" INTEGER NOT NULL DEFAULT 0,
            "metadata" TEXT NOT NULL, "metadataVersion" INTEGER NOT NULL DEFAULT 0,
            "agentState" TEXT, "agentStateVersion" INTEGER NOT NULL DEFAULT 0, "dataEncryptionKey" BYTEA,
            "seq" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT TRUE,
            "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE ("accountId", "tag")
        );
        INSERT INTO "Session" ("id", "tag", "accountId", "metadata", "agentState", "dataEncryptionKey", "avatarRef", "avatarPreview", "avatarVersion") VALUES
            ('own', 'happyherd-default-assistant', 'owner', 'metadata', 'state', decode('010203', 'hex'), 'ref', 'preview', 2),
            ('other-owned', 'other-tag', 'owner', 'other', NULL, NULL, NULL, NULL, 0),
            ('foreign', 'tag', 'other', 'foreign', NULL, NULL, NULL, NULL, 0);`);
        sessionRoutes(typed);
        await typed.ready();
        const headers = { 'x-user-id': 'owner' };
        const list = await typed.inject({ method: 'GET', url: '/v2/sessions', headers });
        expect(list.statusCode).toBe(200);
        expect(list.json().sessions.map((row: { id: string }) => row.id)).toEqual(['own', 'other-owned']);
        expect(list.json()).toMatchObject({ nextCursor: null, hasNext: false });
        const onePage = await typed.inject({ method: 'GET', url: '/v2/sessions?limit=1', headers });
        expect(onePage.json()).toMatchObject({ sessions: [list.json().sessions[0]], nextCursor: 'cursor_v1_own', hasNext: true });
        const secondPage = await typed.inject({ method: 'GET', url: '/v2/sessions?limit=1&cursor=cursor_v1_own', headers });
        expect(secondPage.json()).toMatchObject({ sessions: [list.json().sessions[1]], nextCursor: null, hasNext: false });
        for (const url of ['/v2/sessions?id=own', '/v2/sessions?id=own&cursor=cursor_v1_a']) {
            const response = await typed.inject({ method: 'GET', url, headers });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ sessions: [list.json().sessions[0]], nextCursor: null, hasNext: false });
        }
        for (const id of ['foreign', 'unknown']) {
            const response = await typed.inject({ method: 'GET', url: `/v2/sessions?id=${id}`, headers });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ sessions: [], nextCursor: null, hasNext: false });
        }
        expect((await typed.inject({ method: 'GET', url: '/v2/sessions?id=', headers })).statusCode).toBe(400);
        expect((await typed.inject({ method: 'GET', url: '/v2/sessions?id=own' })).statusCode).toBe(401);
        const assistant = await typed.inject({ method: 'GET', url: '/v1/sessions/default-assistant', headers });
        expect(assistant.statusCode).toBe(200);
        expect(assistant.json().session).toMatchObject({ id: 'own', lastMessage: null, dataEncryptionKey: 'AQID' });
    } finally {
        await typed.close();
        await fixture.db.$disconnect();
        await pg.close();
    }
}, 30_000);
