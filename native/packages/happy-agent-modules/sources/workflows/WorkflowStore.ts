import { Value } from "@sinclair/typebox/value";

import {
    workflowLogPageSchema,
    workflowPageSchema,
    workflowRunSchema,
    type WorkflowLogPage,
    type WorkflowPage,
    type WorkflowRun,
} from "./Workflow.js";

/**
 * A stored run has to obey its own timeline, and nothing in the schema says so: a run cannot start
 * before it was created, pause in the future, or finish at a moment other than its last update.
 * These are checked where a row is read, because a database that outlives the code is the one
 * place a run can arrive in a shape this module never wrote.
 */
export function assertWorkflowRun(value: unknown): asserts value is WorkflowRun {
    if (!Value.Check(workflowRunSchema, value)) {
        throw new Error("A stored workflow run is not a valid run.");
    }
    if (value.updatedAt < value.createdAt) {
        throw new Error("A stored workflow run was updated before it was created.");
    }
    if (value.startedAt < value.createdAt || value.startedAt > value.updatedAt) {
        throw new Error("A stored workflow run started outside its own lifetime.");
    }
    if (value.status === "paused" && value.pausedAt !== value.updatedAt) {
        throw new Error("A stored paused workflow run did not pause when it was last updated.");
    }
    if (
        (value.status === "completed" ||
            value.status === "failed" ||
            value.status === "cancelled") &&
        value.finishedAt !== value.updatedAt
    ) {
        throw new Error("A stored finished workflow run did not finish when it was last updated.");
    }
}

export function assertWorkflowPage(value: unknown): asserts value is WorkflowPage {
    if (!Value.Check(workflowPageSchema, value)) {
        throw new Error("A workflow page was assembled in an invalid shape.");
    }
    for (const run of value.runs) assertWorkflowRun(run);
}

export function assertWorkflowLogPage(value: unknown): asserts value is WorkflowLogPage {
    if (!Value.Check(workflowLogPageSchema, value)) {
        throw new Error("A workflow log page was assembled in an invalid shape.");
    }
}
