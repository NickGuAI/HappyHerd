import { Type, type Static } from "@sinclair/typebox";
import type { Context } from "@steve.kite/stdlib";

import {
    goalAgentIdSchema,
    goalOperationIdSchema,
    goalTimestampSchema,
    sessionGoalSchema,
} from "./SessionGoal.js";

/**
 * Context is an opaque host-owned carrier. Context's useful state is carried by namespaces rather
 * than enumerable properties, so Goal only requires an object at the runtime boundary.
 */
const goalContextSchema = Type.Unsafe<Context>(Type.Object({}, { additionalProperties: false }));
const goalVoidOrPromiseVoidSchema = Type.Union([Type.Void(), Type.Promise(Type.Void())]);

const goalSetEventSchema = Type.Object(
    {
        type: Type.Literal("goal_set"),
        eventId: goalOperationIdSchema,
        at: goalTimestampSchema,
        agentId: goalAgentIdSchema,
        goal: sessionGoalSchema,
    },
    { additionalProperties: false },
);
const goalStatusEventSchema = Type.Object(
    {
        type: Type.Literal("goal_status_changed"),
        eventId: goalOperationIdSchema,
        at: goalTimestampSchema,
        agentId: goalAgentIdSchema,
        goal: sessionGoalSchema,
    },
    { additionalProperties: false },
);
const goalClearedEventSchema = Type.Object(
    {
        type: Type.Literal("goal_cleared"),
        eventId: goalOperationIdSchema,
        at: goalTimestampSchema,
        agentId: goalAgentIdSchema,
    },
    { additionalProperties: false },
);

/** Stable event identity and timestamp are attached before any subscriber sees the event. */
export const goalEventSchema = Type.Union([
    goalSetEventSchema,
    goalStatusEventSchema,
    goalClearedEventSchema,
]);

export type GoalEvent = Static<typeof goalEventSchema>;

/** One subscriber taken after construction. */
export const goalEventListenerSchema = Type.Function(
    [goalContextSchema, goalEventSchema],
    goalVoidOrPromiseVoidSchema,
);

export type GoalEventListener = Static<typeof goalEventListenerSchema>;

/** Ends a subscription. Calling it more than once does nothing further. */
export type GoalUnsubscribe = () => void;
export { goalContextSchema, goalVoidOrPromiseVoidSchema };
