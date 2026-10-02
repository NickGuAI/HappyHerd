import { Value } from "@sinclair/typebox/value";

import { sessionGoalSchema, type SessionGoal } from "../SessionGoal.js";

/** TypeBox shape plus the timestamp ordering every persisted Goal row must satisfy. */
export function assertSessionGoalSemantics(value: unknown): asserts value is SessionGoal {
    if (!Value.Check(sessionGoalSchema, value)) {
        throw new Error("The stored goal is invalid.");
    }
    if (value.updatedAt < value.createdAt) {
        throw new Error("The stored goal has invalid timestamps.");
    }
}
