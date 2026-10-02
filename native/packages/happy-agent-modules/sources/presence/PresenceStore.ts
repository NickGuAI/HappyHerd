import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import { presenceContextSchema, type PresenceEvent } from "./PresenceEvent.js";
import { presenceDatabaseSchema, type PresenceDatabase } from "./PresenceDatabase.js";
import {
    presenceScheduleInputSchema,
    presenceScheduleSchema,
    type PresenceSchedule,
    type PresenceScheduleInput,
} from "./PresenceSchedule.js";
import {
    presenceDefinitionSchema,
    presenceIdSchema,
    presenceStateSchema,
    type PresenceDefinition,
    type PresenceState,
} from "./PresenceState.js";

export const presenceStoreSchema = presenceDatabaseSchema;
export const presenceScheduleStoreSchema = Type.Object(
    {
        list: Type.Function(
            [
                presenceContextSchema,
                Type.Object(
                    { limit: Type.Integer({ minimum: 1, maximum: 10_000 }) },
                    { additionalProperties: false },
                ),
            ],
            Type.Promise(Type.Array(presenceScheduleSchema, { maxItems: 10_000 })),
        ),
        set: Type.Function(
            [presenceContextSchema, presenceScheduleInputSchema, presenceIdSchema],
            Type.Promise(presenceScheduleSchema),
        ),
        clear: Type.Function(
            [presenceContextSchema, presenceIdSchema],
            Type.Promise(Type.Boolean()),
        ),
    },
    { additionalProperties: false },
);

export type PresenceStore = PresenceDatabase;

export const presenceReaderSchema = Type.Object(
    {
        read: Type.Function(
            [presenceContextSchema],
            Type.Promise(Type.Union([presenceStateSchema, Type.Undefined()])),
        ),
    },
    { additionalProperties: false },
);

export type PresenceReader = Static<typeof presenceReaderSchema>;
export type PresenceScheduleStore = PresenceStore["schedules"];

export function assertPresenceStateResult(value: unknown): asserts value is PresenceState {
    if (!Value.Check(presenceStateSchema, value)) {
        throw new Error("Presence database returned an invalid presence state.");
    }
}

export function assertPresenceDefinitionResult(
    value: unknown,
): asserts value is PresenceDefinition {
    if (!Value.Check(presenceDefinitionSchema, value)) {
        throw new Error("Presence database returned an invalid presence definition.");
    }
}

export function assertPresenceScheduleResult(value: unknown): asserts value is PresenceSchedule {
    if (!Value.Check(presenceScheduleSchema, value)) {
        throw new Error("Presence database returned an invalid presence schedule.");
    }
}

export function assertPresenceContext(value: unknown): asserts value is Context {
    if (!Value.Check(presenceContextSchema, value)) {
        throw new Error("Presence context is invalid.");
    }
}

export type {
    PresenceDefinition,
    PresenceEvent,
    PresenceSchedule,
    PresenceScheduleInput,
    PresenceState,
};
