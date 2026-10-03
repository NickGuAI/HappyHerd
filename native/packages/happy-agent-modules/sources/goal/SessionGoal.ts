import { Type, type Static } from "@sinclair/typebox";

/** Bounds shared by Goal's public and persisted contracts. */
export const MAX_GOAL_AGENT_ID_LENGTH = 256;
export const MAX_GOAL_OPERATION_ID_LENGTH = 128;
export const MAX_GOAL_OBJECTIVE_CHARS = 20_000;
export const MAX_GOAL_OUTPUT_CHARACTERS = 100_000;
export const MAX_GOAL_TITLE_CHARS = 80;
/** Consecutive failed active turns before Goal blocks the current goal. */
export const FAILED_TURNS_BEFORE_BLOCKED = 3;

export const goalAgentIdSchema = Type.String({
    minLength: 1,
    maxLength: MAX_GOAL_AGENT_ID_LENGTH,
});
export const goalOperationIdSchema = Type.String({
    minLength: 1,
    maxLength: MAX_GOAL_OPERATION_ID_LENGTH,
});
export const goalLifecycleIdSchema = goalOperationIdSchema;
export const goalMessageIdSchema = Type.String({
    minLength: 2,
    maxLength: 32,
    pattern: "^[a-z][a-z0-9]*$",
});
export const goalTimestampSchema = Type.Integer({ minimum: 0 });
export const goalObjectiveSchema = Type.String({
    minLength: 1,
    maxLength: MAX_GOAL_OBJECTIVE_CHARS,
});
export const goalTitleSchema = Type.String({
    minLength: 1,
    maxLength: MAX_GOAL_TITLE_CHARS,
});

export const goalStatusSchema = Type.Union([
    Type.Literal("active"),
    Type.Literal("paused"),
    Type.Literal("blocked"),
    Type.Literal("complete"),
]);

export const sessionGoalSchema = Type.Object(
    {
        createdAt: goalTimestampSchema,
        objective: goalObjectiveSchema,
        status: goalStatusSchema,
        updatedAt: goalTimestampSchema,
    },
    { additionalProperties: false },
);

export type GoalAgentId = Static<typeof goalAgentIdSchema>;
export type GoalOperationId = Static<typeof goalOperationIdSchema>;
export type GoalMessageId = Static<typeof goalMessageIdSchema>;
export type GoalStatus = Static<typeof goalStatusSchema>;
export type SessionGoal = Static<typeof sessionGoalSchema>;
