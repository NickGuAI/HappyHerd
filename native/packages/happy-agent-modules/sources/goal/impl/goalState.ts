import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import {
    FAILED_TURNS_BEFORE_BLOCKED,
    goalAgentIdSchema,
    goalLifecycleIdSchema,
    sessionGoalSchema,
    type SessionGoal,
} from "../SessionGoal.js";
import type { GoalDatabase } from "./goalDatabase.js";
import { assertSessionGoalSemantics } from "./goalValidation.js";

export const GOAL_KEY = "goal";
export const GOAL_FAILURE_COUNT_KEY = "failureCount";
export const GOAL_LAST_INFERENCE_KEY = "lastInference";
export const GOAL_CONTINUATION_ID_KEY = "continuationId";
export const GOAL_LIFECYCLE_KEY = "lifecycle";
export const GOAL_OBSERVED_LIFECYCLE_ID_KEY = "observedLifecycleId";

export const goalLifecycleStateSchema = Type.Object(
    {
        activation: Type.Union([Type.Literal("agent"), Type.Literal("external")]),
        id: goalLifecycleIdSchema,
        goal: sessionGoalSchema,
    },
    { additionalProperties: false },
);
export type GoalLifecycleState = Static<typeof goalLifecycleStateSchema>;

const goalStoredFailureCountSchema = Type.Integer({
    minimum: 1,
    maximum: FAILED_TURNS_BEFORE_BLOCKED - 1,
});

export const goalAuthoritativeStateSchema = Type.Object(
    {
        goal: Type.Union([sessionGoalSchema, Type.Undefined()]),
        lifecycle: Type.Union([goalLifecycleStateSchema, Type.Undefined()]),
        failureCount: Type.Union([goalStoredFailureCountSchema, Type.Undefined()]),
    },
    { additionalProperties: false },
);
export type GoalAuthoritativeState = Static<typeof goalAuthoritativeStateSchema>;

export async function readGoal(
    ctx: Context,
    kv: GoalDatabase,
    agentId: string,
): Promise<SessionGoal | undefined> {
    return (await readGoalAuthoritativeState(ctx, kv, agentId)).goal;
}

export async function readGoalAuthoritativeState(
    ctx: Context,
    kv: GoalDatabase,
    agentId: string,
): Promise<GoalAuthoritativeState> {
    if (!Value.Check(goalAgentIdSchema, agentId)) {
        throw new Error("Goal agent ID is invalid.");
    }
    const goal = await readGoalState(ctx, kv);
    const lifecycle = await readGoalLifecycle(ctx, kv);
    const failureCount = await kv.read(ctx, GOAL_FAILURE_COUNT_KEY);
    if (goal?.status === "active") {
        if (lifecycle === undefined || !Value.Equal(lifecycle.goal, goal)) {
            throw new Error("An active Goal requires its exact lifecycle sidecar.");
        }
        if (
            failureCount !== undefined &&
            !Value.Check(goalStoredFailureCountSchema, failureCount)
        ) {
            throw new Error("The active Goal failure count is invalid.");
        }
    } else if (lifecycle !== undefined || failureCount !== undefined) {
        throw new Error("An inactive Goal retains active-lifecycle state.");
    }
    const state = { goal, lifecycle, failureCount };
    if (!Value.Check(goalAuthoritativeStateSchema, state)) {
        throw new Error("The authoritative Goal state is invalid.");
    }
    return structuredClone(state);
}

export async function readGoalLifecycle(
    ctx: Context,
    kv: GoalDatabase,
): Promise<GoalLifecycleState | undefined> {
    const stored = await kv.read(ctx, GOAL_LIFECYCLE_KEY);
    if (stored === undefined) return undefined;
    if (!Value.Check(goalLifecycleStateSchema, stored)) {
        throw new Error("The stored Goal lifecycle sidecar is invalid.");
    }
    assertSessionGoalSemantics(stored.goal);
    return structuredClone(stored);
}

export async function writeGoalLifecycle(
    ctx: Context,
    kv: GoalDatabase,
    lifecycle: GoalLifecycleState,
): Promise<void> {
    if (!Value.Check(goalLifecycleStateSchema, lifecycle)) {
        throw new Error("Goal lifecycle sidecar is invalid.");
    }
    assertSessionGoalSemantics(lifecycle.goal);
    await kv.write(ctx, GOAL_LIFECYCLE_KEY, structuredClone(lifecycle));
}

export async function readGoalState(
    ctx: Context,
    kv: GoalDatabase,
): Promise<SessionGoal | undefined> {
    const stored = await kv.read(ctx, GOAL_KEY);
    if (stored === undefined) return undefined;
    assertSessionGoalSemantics(stored);
    return structuredClone(stored);
}

export async function writeGoal(ctx: Context, kv: GoalDatabase, goal: SessionGoal): Promise<void> {
    assertSessionGoalSemantics(goal);
    await kv.write(ctx, GOAL_KEY, structuredClone(goal));
}

export async function clearGoal(ctx: Context, kv: GoalDatabase): Promise<void> {
    await kv.delete(ctx, GOAL_KEY);
}
