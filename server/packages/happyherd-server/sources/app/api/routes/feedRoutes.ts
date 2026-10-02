import { z } from "zod";
import { Fastify } from "../types";
import { AutomationBlockedFeedSchema, FeedBodySchema } from "@/app/feed/types";
import { feedGet } from "@/app/feed/feedGet";
import { feedPost } from "@/app/feed/feedPost";
import { Context } from "@/context";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { buildFeedReadUpdate, eventRouter } from "@/app/events/eventRouter";
import { randomKeyNaked } from "@/utils/randomKeyNaked";

const feedReadId = z.object({ id: z.string().min(1) }).strict();
const feedReadThrough = z.object({
    through: z.string().regex(/^0-(0|[1-9]\d*)$/)
        .refine(value => Number.isSafeInteger(Number(value.slice(2))))
}).strict();

export function feedRoutes(app: Fastify) {
    app.post('/v1/feed/automation-blocked', {
        preHandler: app.authenticate,
        schema: {
            body: AutomationBlockedFeedSchema.omit({ kind: true }),
            response: {
                200: z.object({ ok: z.literal(true) }),
                404: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const { machineId, automationId, runId } = request.body;
        const posted = await inTx(async (tx) => {
            const machine = await tx.machine.findFirst({
                where: { id: machineId, accountId: request.userId },
                select: { id: true }
            });
            if (!machine) return false;

            // Retried delivery must not advance the cursor or mark the post unread again.
            const repeatKey = `automation_blocked:${JSON.stringify([machineId, automationId, runId])}`;
            const existing = await tx.userFeedItem.findUnique({
                where: { userId_repeatKey: { userId: request.userId, repeatKey } }
            });
            if (!existing) {
                await feedPost(tx, Context.create(request.userId), {
                    kind: 'automation_blocked',
                    ...request.body
                }, repeatKey);
            }
            return true;
        });
        if (!posted) return reply.code(404).send({ error: 'Machine not found' });
        return reply.send({ ok: true });
    });

    app.get('/v1/feed', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                before: z.string().optional(),
                after: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(50)
            }).optional(),
            response: {
                200: z.object({
                    items: z.array(z.object({
                        id: z.string(),
                        body: FeedBodySchema,
                        repeatKey: z.string().nullable(),
                        cursor: z.string(),
                        createdAt: z.number(),
                        readAt: z.number().nullable()
                    })),
                    hasMore: z.boolean()
                })
            }
        }
    }, async (request, reply) => {
        const items = await feedGet(db, Context.create(request.userId), {
            cursor: {
                before: request.query?.before,
                after: request.query?.after
            },
            limit: request.query?.limit
        });
        return reply.send({ items: items.items, hasMore: items.hasMore });
    });

    app.post('/v1/feed/read', {
        preHandler: app.authenticate,
        schema: {
            body: z.union([feedReadId, feedReadThrough]),
            response: {
                200: z.union([
                    feedReadId.extend({ readAt: z.number() }),
                    feedReadThrough.extend({ readAt: z.number() })
                ])
            }
        }
    }, async (request, reply) => {
        const criteria = request.body;
        const readAt = new Date();
        const seq = await inTx(async (tx) => {
            // Bound Done to the observed snapshot so newer arrivals stay unread.
            const changed = await tx.userFeedItem.updateMany({
                where: {
                    userId: request.userId,
                    readAt: null,
                    ...('id' in criteria
                        ? { id: criteria.id }
                        : { counter: { lte: BigInt(criteria.through.slice(2)) } })
                },
                data: { readAt }
            });
            if (changed.count === 0) return null;
            const account = await tx.account.update({
                where: { id: request.userId },
                data: { seq: { increment: 1 } },
                select: { seq: true }
            });
            return account.seq;
        });
        const result = { ...criteria, readAt: readAt.getTime() };
        if (seq !== null) {
            eventRouter.emitUpdate({
                userId: request.userId,
                payload: buildFeedReadUpdate(result, seq, randomKeyNaked(12)),
                recipientFilter: { type: 'user-scoped-only' }
            });
        }
        return reply.send(result);
    });
}
