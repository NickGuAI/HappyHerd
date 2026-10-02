import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { presenceContextSchema } from "./PresenceEvent.js";
import { presenceUserInputStateSchema, type PresenceUserInputState } from "./PresenceState.js";

const voidOrPromiseVoidSchema = Type.Union([Type.Void(), Type.Promise(Type.Void())]);
const presenceUserInputChangeStateSchema = Type.Union([
    presenceUserInputStateSchema,
    Type.Undefined(),
]);

/**
 * What `subscribeUserInput` calls: the effective state now, and again whenever it changes.
 * Presence belongs to the whole installation, so no agent identity takes part in it.
 */
export const presenceUserInputChangeCallbackSchema = Type.Function(
    [presenceContextSchema, presenceUserInputChangeStateSchema],
    voidOrPromiseVoidSchema,
);

export type PresenceUserInputChangeCallback = Static<typeof presenceUserInputChangeCallbackSchema>;

export function assertPresenceUserInputResult(
    value: unknown,
): asserts value is PresenceUserInputState | undefined {
    if (!Value.Check(presenceUserInputChangeStateSchema, value)) {
        throw new Error("Presence user-input state result is invalid.");
    }
}
