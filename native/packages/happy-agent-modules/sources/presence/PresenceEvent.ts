import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import { presenceDefinitionSchema } from "./PresenceState.js";
import { presenceScheduleSchema } from "./PresenceSchedule.js";
import { presenceStateSchema } from "./PresenceState.js";

/**
 * Context is owned by Agent Base and the host. Presence carries it through unchanged and never
 * inspects its fields, so the runtime boundary only requires an object while the unsafe type
 * preserves the published Context type for callers.
 */
export const presenceContextSchema = Type.Unsafe<Context>(
    Type.Object({}, { additionalProperties: true }),
);

const eventIdSchema = Type.String({ minLength: 1, maxLength: 128 });
const eventAtSchema = Type.Integer({ minimum: 0 });

export const presenceEventSchema = Type.Union([
    Type.Object(
        {
            type: Type.Literal("presence_changed"),
            eventId: eventIdSchema,
            at: eventAtSchema,
            previous: Type.Union([presenceStateSchema, Type.Null()]),
            current: presenceStateSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("presence_cleared"),
            eventId: eventIdSchema,
            at: eventAtSchema,
            previous: presenceStateSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("presence_schedule_set"),
            eventId: eventIdSchema,
            at: eventAtSchema,
            schedule: presenceScheduleSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("presence_schedule_cleared"),
            eventId: eventIdSchema,
            at: eventAtSchema,
            scheduleId: eventIdSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("presence_definition_set"),
            eventId: eventIdSchema,
            at: eventAtSchema,
            definition: presenceDefinitionSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("presence_definition_cleared"),
            eventId: eventIdSchema,
            at: eventAtSchema,
            presenceId: eventIdSchema,
        },
        { additionalProperties: false },
    ),
]);

export type PresenceEvent = Static<typeof presenceEventSchema>;

/** What a caller registers with `onEvent` or `onEventTransactional` after construction. */
export const presenceEventListenerSchema = Type.Function(
    [presenceContextSchema, presenceEventSchema],
    Type.Union([Type.Void(), Type.Promise(Type.Void())]),
);

/** The listener contract is inferred directly from the runtime schema. */
export type PresenceEventListener = Static<typeof presenceEventListenerSchema>;

/** Undoing a registration; calling it twice is harmless. */
export type PresenceUnsubscribe = () => void;

export function assertPresenceEventListener(
    value: unknown,
): asserts value is PresenceEventListener {
    if (!Value.Check(presenceEventListenerSchema, value)) {
        throw new Error("Presence event listener must be a function.");
    }
}
