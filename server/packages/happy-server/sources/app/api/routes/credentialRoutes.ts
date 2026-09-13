import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
    SavedCredentialCreateRequestSchema,
    SavedCredentialUpdateRequestSchema,
    ManagedCredentialTypeSchema,
    ManagedCredentialUsageSchema,
    type SavedCredentialErrorCode,
} from '@slopus/happy-wire';
import { decryptString, encryptString } from '@/modules/encrypt';
import { db } from '@/storage/db';
import type { Fastify } from '../types';

const MAX_CREDENTIALS_PER_ACCOUNT = 200;
const credentialParams = z.object({ id: z.string().min(1).max(100) });
type StoredCredential = {
    id: string;
    accountId: string;
    name: string;
    kind: string;
    usages: unknown;
    encryptedPayload: Uint8Array<ArrayBuffer>;
    version: number;
    createdAt: Date;
    updatedAt: Date;
};

type CredentialPayload = { service: string; username: string | null; secret: string };

function encryptionPath(accountId: string, id: string): string[] {
    return ['user', accountId, 'saved-credentials', id, 'payload'];
}

function readPayload(row: StoredCredential): CredentialPayload {
    const parsed = JSON.parse(decryptString(
        encryptionPath(row.accountId, row.id),
        row.encryptedPayload,
    )) as unknown;
    return z.object({ service: z.string(), username: z.string().nullable(), secret: z.string() }).parse(parsed);
}

function summary(row: StoredCredential) {
    const payload = readPayload(row);
    return {
        id: row.id,
        name: row.name,
        type: ManagedCredentialTypeSchema.parse(row.kind),
        service: payload.service,
        username: payload.username,
        usage: z.array(ManagedCredentialUsageSchema).parse(row.usages),
        version: row.version,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
    };
}

function isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function conflict(code: SavedCredentialErrorCode, error: string) {
    return { code, error };
}

export function credentialRoutes(app: Fastify) {
    app.get('/v1/credentials', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const rows = await db.savedCredential.findMany({
            where: { accountId: request.userId },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        });
        reply.header('Cache-Control', 'no-store');
        return { credentials: rows.map((row) => summary(row as StoredCredential)) };
    });

    app.post('/v1/credentials', {
        preHandler: app.authenticate,
        schema: { body: SavedCredentialCreateRequestSchema },
    }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const count = await db.savedCredential.count({ where: { accountId: request.userId } });
        if (count >= MAX_CREDENTIALS_PER_ACCOUNT) {
            return reply.code(409).send(conflict(
                'saved-credential-limit-reached',
                'Saved credential limit reached',
            ));
        }
        const id = randomUUID();
        const payload: CredentialPayload = {
            service: request.body.service,
            username: request.body.username?.trim() || null,
            secret: request.body.secret,
        };
        try {
            const row = await db.savedCredential.create({
                data: {
                    id,
                    accountId: request.userId,
                    name: request.body.name,
                    kind: request.body.type,
                    usages: request.body.usage,
                    encryptedPayload: encryptString(
                        encryptionPath(request.userId, id),
                        JSON.stringify(payload),
                    ),
                },
            });
            return reply.code(201).send(summary(row as StoredCredential));
        } catch (error) {
            if (isUniqueConflict(error)) {
                return reply.code(409).send(conflict(
                    'saved-credential-name-conflict',
                    'A saved credential with this name already exists',
                ));
            }
            throw error;
        }
    });

    app.put('/v1/credentials/:id', {
        preHandler: app.authenticate,
        schema: { params: credentialParams, body: SavedCredentialUpdateRequestSchema.omit({ id: true }) },
    }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const existing = await db.savedCredential.findFirst({
            where: { id: request.params.id, accountId: request.userId },
        }) as StoredCredential | null;
        if (!existing) return reply.code(404).send({ error: 'Saved credential not found' });
        const oldPayload = readPayload(existing);
        const payload: CredentialPayload = {
            service: request.body.service,
            username: request.body.username?.trim() || null,
            secret: request.body.secret ?? oldPayload.secret,
        };
        try {
            const updated = await db.savedCredential.updateMany({
                where: {
                    id: existing.id,
                    accountId: request.userId,
                    version: request.body.expectedVersion,
                },
                data: {
                    name: request.body.name,
                    kind: request.body.type,
                    usages: request.body.usage,
                    version: { increment: 1 },
                    encryptedPayload: encryptString(
                        encryptionPath(request.userId, existing.id),
                        JSON.stringify(payload),
                    ),
                },
            });
            if (updated.count !== 1) {
                return reply.code(409).send(conflict(
                    'saved-credential-version-conflict',
                    'Saved credential changed; reload and try again',
                ));
            }
            const row = await db.savedCredential.findFirst({
                where: { id: existing.id, accountId: request.userId },
            });
            if (!row) return reply.code(404).send({ error: 'Saved credential not found' });
            return reply.send(summary(row as StoredCredential));
        } catch (error) {
            if (isUniqueConflict(error)) {
                return reply.code(409).send(conflict(
                    'saved-credential-name-conflict',
                    'A saved credential with this name already exists',
                ));
            }
            throw error;
        }
    });

    app.post('/v1/credentials/:id/reveal', {
        preHandler: app.authenticate,
        schema: { params: credentialParams },
    }, async (request, reply) => {
        const row = await db.savedCredential.findFirst({
            where: { id: request.params.id, accountId: request.userId },
        }) as StoredCredential | null;
        if (!row) return reply.code(404).send({ error: 'Saved credential not found' });
        const payload = readPayload(row);
        reply.header('Cache-Control', 'no-store');
        return reply.send({ id: row.id, secret: payload.secret });
    });

    app.delete('/v1/credentials/:id', {
        preHandler: app.authenticate,
        schema: { params: credentialParams },
    }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        await db.savedCredential.deleteMany({
            where: { id: request.params.id, accountId: request.userId },
        });
        return { success: true };
    });
}
