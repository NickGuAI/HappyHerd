import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

type Row = {
    id: string;
    accountId: string;
    name: string;
    kind: string;
    usages: string[];
    encryptedPayload: Buffer;
    version: number;
    createdAt: Date;
    updatedAt: Date;
};

const state = vi.hoisted(() => ({ rows: new Map<string, Row>() }));
const dbMock = vi.hoisted(() => ({
    count: vi.fn(async ({ where }: any) => [...state.rows.values()].filter((row) => row.accountId === where.accountId).length),
    findMany: vi.fn(async ({ where }: any) => [...state.rows.values()].filter((row) => row.accountId === where.accountId)),
    findFirst: vi.fn(async ({ where }: any) => [...state.rows.values()].find(
        (row) => row.id === where.id && row.accountId === where.accountId,
    ) ?? null),
    create: vi.fn(async ({ data }: any) => {
        if ([...state.rows.values()].some((row) => row.accountId === data.accountId && row.name === data.name)) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { ...data, version: 0, createdAt: new Date(1_000), updatedAt: new Date(1_000) } as Row;
        state.rows.set(row.id, row);
        return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
        const current = state.rows.get(where.id);
        if (!current || current.accountId !== where.accountId || current.version !== where.version) return { count: 0 };
        if ([...state.rows.values()].some((row) => row.id !== current.id && row.accountId === current.accountId && row.name === data.name)) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = {
            ...current,
            ...data,
            version: current.version + (data.version?.increment ?? 0),
            updatedAt: new Date(2_000),
        } as Row;
        state.rows.set(row.id, row);
        return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
        const row = state.rows.get(where.id);
        if (row?.accountId === where.accountId) state.rows.delete(where.id);
        return { count: row?.accountId === where.accountId ? 1 : 0 };
    }),
}));

vi.mock('@/storage/db', () => ({ db: { savedCredential: dbMock } }));
vi.mock('@/modules/encrypt', () => ({
    encryptString: vi.fn((_path: string[], value: string) => Buffer.from(value)),
    decryptString: vi.fn((_path: string[], value: Uint8Array) => Buffer.from(value).toString('utf8')),
}));

import { credentialRoutes } from './credentialRoutes';

async function createApp(accountId = 'account-1') {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: any) => { request.userId = accountId; });
    credentialRoutes(app as any);
    await app.ready();
    return app;
}

describe('saved credential routes', () => {
    beforeEach(() => {
        state.rows.clear();
        vi.clearAllMocks();
    });

    it('persists encrypted payloads while keeping list responses secret-free', async () => {
        const app = await createApp();
        const created = await app.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: {
                name: 'Example token',
                type: 'token',
                service: 'api.example.test',
                username: 'demo-user',
                usage: ['skills', 'mcp'],
                secret: 'private-value',
            },
        });
        expect(created.statusCode).toBe(201);
        const id = created.json().id as string;
        const list = await app.inject({ method: 'GET', url: '/v1/credentials' });
        expect(list.statusCode).toBe(200);
        expect(list.headers['cache-control']).toBe('no-store');
        expect(created.headers['cache-control']).toBe('no-store');
        expect(list.json().credentials).toEqual([expect.objectContaining({
            id,
            name: 'Example token',
            username: 'demo-user',
            usage: ['skills', 'mcp'],
        })]);
        expect(list.body).not.toContain('private-value');
        expect(JSON.parse(state.rows.get(id)!.encryptedPayload.toString())).toEqual({
            service: 'api.example.test',
            username: 'demo-user',
            secret: 'private-value',
        });
        await app.close();
    });

    it('reveals only the exact caller-owned credential', async () => {
        const owner = await createApp('owner');
        const created = await owner.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: { name: 'Owner key', type: 'token', service: '', usage: [], secret: 'owner-secret' },
        });
        const id = created.json().id as string;
        const other = await createApp('other');
        const revealed = await owner.inject({ method: 'POST', url: `/v1/credentials/${id}/reveal` });
        expect(revealed.statusCode).toBe(200);
        expect(revealed.headers['cache-control']).toBe('no-store');
        const denied = await other.inject({ method: 'POST', url: `/v1/credentials/${id}/reveal` });
        expect(denied.statusCode).toBe(404);
        expect(denied.body).not.toContain('owner-secret');
        await owner.close();
        await other.close();
    });

    it('updates metadata while retaining an omitted secret and rejects name collisions', async () => {
        const app = await createApp();
        const create = async (name: string, secret: string) => (await app.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: { name, type: 'login', service: 'portal.example.test', usage: ['browser'], secret },
        })).json().id as string;
        const first = await create('First', 'keep-me');
        await create('Second', 'other');
        const updated = await app.inject({
            method: 'PUT',
            url: `/v1/credentials/${first}`,
            payload: { name: 'Renamed', type: 'login', service: 'new.example.test', usage: ['browser'], expectedVersion: 0 },
        });
        expect(updated.statusCode).toBe(200);
        const revealed = await app.inject({ method: 'POST', url: `/v1/credentials/${first}/reveal` });
        expect(revealed.json()).toEqual({ id: first, secret: 'keep-me' });
        const conflict = await app.inject({
            method: 'PUT',
            url: `/v1/credentials/${first}`,
            payload: { name: 'Second', type: 'login', service: '', usage: [], expectedVersion: 1 },
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toMatchObject({ code: 'saved-credential-name-conflict' });
        await app.close();
    });

    it('labels create name and account limit conflicts without returning secrets', async () => {
        const app = await createApp();
        const payload = {
            name: 'Duplicate',
            type: 'token',
            service: '',
            usage: [],
            secret: 'do-not-return',
        };
        expect((await app.inject({ method: 'POST', url: '/v1/credentials', payload })).statusCode).toBe(201);
        const duplicate = await app.inject({ method: 'POST', url: '/v1/credentials', payload });
        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.json()).toMatchObject({ code: 'saved-credential-name-conflict' });
        expect(duplicate.body).not.toContain(payload.secret);

        dbMock.count.mockResolvedValueOnce(200);
        const limited = await app.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: { ...payload, name: 'At limit' },
        });
        expect(limited.statusCode).toBe(409);
        expect(limited.json()).toMatchObject({ code: 'saved-credential-limit-reached' });
        expect(limited.body).not.toContain(payload.secret);
        await app.close();
    });

    it('requires a secret on create and rejects a stale update version', async () => {
        const app = await createApp();
        const invalid = await app.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: { name: 'Missing', type: 'token', service: '', usage: [] },
        });
        expect(invalid.statusCode).toBe(400);

        const created = await app.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: { name: 'Versioned', type: 'token', service: '', usage: [], secret: 'value' },
        });
        const id = created.json().id as string;
        const update = {
            name: 'Versioned',
            type: 'token',
            service: '',
            usage: [],
            expectedVersion: 0,
        };
        expect((await app.inject({ method: 'PUT', url: `/v1/credentials/${id}`, payload: update })).statusCode).toBe(200);
        const stale = await app.inject({ method: 'PUT', url: `/v1/credentials/${id}`, payload: update });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({ code: 'saved-credential-version-conflict' });
        expect(stale.body).not.toContain('value');
        await app.close();
    });

    it('deletes only caller-owned rows and treats repeated deletion as success', async () => {
        const app = await createApp();
        const created = await app.inject({
            method: 'POST',
            url: '/v1/credentials',
            payload: { name: 'Disposable', type: 'connection', service: '', usage: [], secret: 'value' },
        });
        const id = created.json().id as string;
        expect((await app.inject({ method: 'DELETE', url: `/v1/credentials/${id}` })).json()).toEqual({ success: true });
        expect((await app.inject({ method: 'DELETE', url: `/v1/credentials/${id}` })).json()).toEqual({ success: true });
        expect(state.rows.has(id)).toBe(false);
        await app.close();
    });
});
