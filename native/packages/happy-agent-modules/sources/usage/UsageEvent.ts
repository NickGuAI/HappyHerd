import { Type, type Static } from "@sinclair/typebox";

import {
    usageAgentIdSchema,
    usageCurrentContextSchema,
    usageIdSchema,
    usageRecordSchema,
    usageTimestampSchema,
} from "./Usage.js";
import { usageContextSchema, usageVoidOrPromiseVoidSchema } from "./UsageContracts.js";

const usageRemovedCountSchema = Type.Integer({
    minimum: 0,
    maximum: 500,
});

/** A stable event emitted by a committed usage mutation. */
export const usageEventSchema = Type.Union([
    Type.Object(
        {
            type: Type.Literal("usage_recorded"),
            eventId: usageIdSchema,
            at: usageTimestampSchema,
            record: usageRecordSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("usage_context_changed"),
            eventId: usageIdSchema,
            at: usageTimestampSchema,
            agentId: usageAgentIdSchema,
            context: Type.Union([usageCurrentContextSchema, Type.Null()]),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("usage_reset"),
            eventId: usageIdSchema,
            at: usageTimestampSchema,
            agentId: Type.Union([usageAgentIdSchema, Type.Null()]),
            removed: usageRemovedCountSchema,
        },
        { additionalProperties: false },
    ),
]);

export type UsageEvent = Static<typeof usageEventSchema>;

/**
 * Someone watching usage change, registered through `UsageModule.onEvent` or
 * `UsageModule.onEventTransactional` after the module has been built.
 *
 * A transactional subscriber runs inside the recording transaction and can fail it; a
 * post-commit one is told about work that is already durable, and usage accounting stays
 * advisory whether or not it succeeds.
 */
export const usageEventListenerSchema = Type.Function(
    [usageContextSchema, usageEventSchema],
    usageVoidOrPromiseVoidSchema,
);

export type UsageEventListener = Static<typeof usageEventListenerSchema>;
