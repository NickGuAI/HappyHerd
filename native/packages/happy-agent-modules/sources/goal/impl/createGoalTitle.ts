import { Value } from "@sinclair/typebox/value";

import { goalTitleSchema, MAX_GOAL_TITLE_CHARS } from "../SessionGoal.js";

/** The short title a host may use when a newly-created goal meets an idle session. */
export function createGoalTitle(objective: string): string {
    const singleLine = objective.replace(/\s+/gu, " ").trim();
    const title =
        singleLine.length <= MAX_GOAL_TITLE_CHARS
            ? singleLine
            : `${singleLine.slice(0, MAX_GOAL_TITLE_CHARS - 1).trimEnd()}…`;
    if (!Value.Check(goalTitleSchema, title)) {
        throw new Error("Goal title is invalid.");
    }
    return title;
}
