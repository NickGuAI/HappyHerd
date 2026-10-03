import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import {
    userInputAgentIdSchema,
    userInputEventIdSchema,
    userInputRequestIdSchema,
    userInputRequestSchema,
} from "./UserInputRequest.js";

export const userInputContextSchema = Type.Unsafe<Context>(
    Type.Object({}, { additionalProperties: true }),
);

const userInputEventEnvelope = {
    eventId: userInputEventIdSchema,
    at: Type.Integer({ minimum: 0 }),
    actingAgentId: userInputAgentIdSchema,
    requestId: userInputRequestIdSchema,
} as const;

/** Immutable snapshots delivered inside and after the host's outermost transaction. */
export const userInputEventSchema = Type.Union([
    Type.Object(
        {
            ...userInputEventEnvelope,
            type: Type.Literal("user_input_requested"),
            request: Type.Extract(
                userInputRequestSchema,
                Type.Object({ status: Type.Literal("pending") }),
            ),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...userInputEventEnvelope,
            type: Type.Literal("user_input_answered"),
            request: Type.Extract(
                userInputRequestSchema,
                Type.Object({ status: Type.Literal("answered") }),
            ),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...userInputEventEnvelope,
            type: Type.Literal("user_input_cancelled"),
            request: Type.Extract(
                userInputRequestSchema,
                Type.Object({ status: Type.Literal("cancelled") }),
            ),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...userInputEventEnvelope,
            type: Type.Literal("user_input_completed"),
            request: Type.Union([
                Type.Extract(userInputRequestSchema, Type.Object({ status: Type.Literal("away") })),
                Type.Extract(
                    userInputRequestSchema,
                    Type.Object({ status: Type.Literal("timed_out") }),
                ),
            ]),
        },
        { additionalProperties: false },
    ),
]);

/** What one subscriber is handed, either inside the transaction or once it commits. */
export const userInputEventListenerSchema = Type.Function(
    [userInputContextSchema, userInputEventSchema],
    Type.Union([Type.Void(), Type.Promise(Type.Void())]),
);

export type UserInputEvent = Static<typeof userInputEventSchema>;
export type UserInputEventListener = Static<typeof userInputEventListenerSchema>;
/** Called once to stop delivery; calling it twice is harmless. */
export type UserInputUnsubscribe = () => void;

export function assertUserInputEvent(value: unknown): asserts value is UserInputEvent {
    if (!Value.Check(userInputEventSchema, value)) {
        throw new Error("User input event is invalid.");
    }
}

export function assertUserInputEventListener(
    value: unknown,
): asserts value is UserInputEventListener {
    if (typeof value !== "function") {
        throw new Error("User input event listener must be a function.");
    }
}
