import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
    createGoalContinuationPrompt,
    goalContinuationPromptSchema,
    MAX_GOAL_CONTINUATION_PROMPT_CHARS,
} from "../../sources/goal/impl/createGoalContinuationPrompt.js";
import { createGoalTitle } from "../../sources/goal/impl/createGoalTitle.js";
import { formatGoalForModel } from "../../sources/goal/impl/formatGoalForModel.js";
import { normalizeGoalObjective } from "../../sources/goal/impl/normalizeGoalObjective.js";
import {
    MAX_GOAL_OBJECTIVE_CHARS,
    MAX_GOAL_TITLE_CHARS,
    type SessionGoal,
} from "../../sources/goal/SessionGoal.js";

function goal(objective: string, status: SessionGoal["status"] = "active"): SessionGoal {
    return {
        createdAt: 10,
        objective,
        status,
        updatedAt: 11,
    };
}

describe("Goal helpers", () => {
    it("normalizes surrounding whitespace but rejects blank and over-bound objectives", () => {
        expect(normalizeGoalObjective(" \n ship it \t")).toBe("ship it");
        expect(() => normalizeGoalObjective(" \n\t ")).toThrow("Goal objective must not be empty.");
        expect(() => normalizeGoalObjective("x".repeat(MAX_GOAL_OBJECTIVE_CHARS + 1))).toThrow(
            `${MAX_GOAL_OBJECTIVE_CHARS.toLocaleString("en-US")} characters or fewer`,
        );
    });

    it("collapses title whitespace and keeps the ellipsis inside the title bound", () => {
        expect(createGoalTitle("  first\n\tsecond   third  ")).toBe("first second third");
        expect(createGoalTitle("x".repeat(MAX_GOAL_TITLE_CHARS))).toBe(
            "x".repeat(MAX_GOAL_TITLE_CHARS),
        );
        expect(createGoalTitle("x".repeat(MAX_GOAL_TITLE_CHARS + 1))).toBe(
            `${"x".repeat(MAX_GOAL_TITLE_CHARS - 1)}…`,
        );
    });

    it("keeps model formatting within the requested budget for a legal maximum objective", () => {
        const formatted = formatGoalForModel(goal("x".repeat(MAX_GOAL_OBJECTIVE_CHARS)), 256);

        expect(formatted.length).toBe(256);
        expect(formatted).toMatch(/^Goal status: active\nObjective: x+…$/);
    });

    it("escapes objective markup and handles the exact worst-case continuation bound", () => {
        const escaped = createGoalContinuationPrompt(goal("a<&>b"));
        expect(escaped).toContain("a&lt;&amp;&gt;b");
        expect(escaped).not.toContain("a<&>b");
        expect(Value.Check(goalContinuationPromptSchema, escaped)).toBe(true);

        const worstCase = createGoalContinuationPrompt(goal("&".repeat(MAX_GOAL_OBJECTIVE_CHARS)));
        expect(worstCase.length).toBe(MAX_GOAL_CONTINUATION_PROMPT_CHARS);
        expect(Value.Check(goalContinuationPromptSchema, worstCase)).toBe(true);
    });

    it("rejects semantically invalid goals before constructing continuation text", () => {
        expect(() =>
            createGoalContinuationPrompt({
                ...goal("ship it"),
                createdAt: 12,
                updatedAt: 11,
            }),
        ).toThrow("invalid timestamps");
        expect(() =>
            createGoalContinuationPrompt({
                ...goal("ship it"),
                status: "active",
                objective: "",
            } as SessionGoal),
        ).toThrow("stored goal is invalid");
    });

    it("formats missing goals and terminal statuses without inventing state", () => {
        expect(formatGoalForModel(null, 256)).toBe("This agent has no goal.");
        expect(formatGoalForModel(goal("done", "complete"), 256)).toBe(
            "Goal status: complete\nObjective: done",
        );
        expect(formatGoalForModel(goal("blocked", "blocked"), 256)).toBe(
            "Goal status: blocked\nObjective: blocked",
        );
    });
});
