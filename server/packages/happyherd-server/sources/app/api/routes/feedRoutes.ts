import { z } from "zod";
import { Fastify } from "../types";
import { AutomationBlockedFeedSchema, FeedBodySchema } from "@/app/feed/types";
import { feedGet } from "@/app/feed/feedGet";
import { Context } from "@/context";
import { db } from "@/storage/db";

import { feedPost } from "@/app/feed/feedPost";
import { inTx } from "@/storage/inTx";

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
                        createdAt: z.number()
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
}