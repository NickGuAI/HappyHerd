import { sql } from "drizzle-orm";
import { agentDatabaseRun } from "@slopus/happy-agent-base";
import { describe, expect, it } from "vitest";

import { GoalModule } from "../../sources/goal/GoalModule.js";
import {
    GOAL_FAILURE_COUNT_KEY,
    GOAL_KEY,
    GOAL_LIFECYCLE_KEY,
    readGoalAuthoritativeState,
    writeGoal,
    writeGoalLifecycle,
} from "../../sources/goal/impl/goalState.js";
import { goalKV } from "../../sources/goal/impl/goalKV.js";
import { FAILED_TURNS_BEFORE_BLOCKED, type SessionGoal } from "../../sources/goal/SessionGoal.js";
import { moduleDatabase } from "../support/moduleDatabase.js";
import { recordingAgents } from "./recordingAgents.js";

const activeGoal: SessionGoal = {
    createdAt: 10,
    objective: "ship it",
    status: "active",
    updatedAt: 10,
};

function newDatabase(name: string) {
    const module = new GoalModule();
    const database = moduleDatabase(module.migrations, name);
    return { module, database };
}

describe("Goal durable state", () => {
    it("survives a fresh module instance and returns detached goal values", async () => {
        const first = newDatabase("goal-state-reload-test");
        await first.database.ready;
        const agents = recordingAgents();
        first.module.beforeStart(first.database.context, agents.ref);
        try {
            const created = await first.module.setGoal(
                first.database.context,
                "agent-a",
                "ship it",
            );

            const reloaded = new GoalModule();
            const loaded = await reloaded.goal(first.database.context, "agent-a");
            expect(loaded).toEqual(created);
            if (loaded === undefined) throw new Error("Expected persisted goal.");
            loaded.objective = "mutated in caller";

            await expect(reloaded.goal(first.database.context, "agent-a")).resolves.toEqual(
                created,
            );
        } finally {
            first.database.close();
        }
    });

    it("keeps one agent's state isolated from another agent's state", async () => {
        const test = newDatabase("goal-agent-isolation-test");
        await test.database.ready;
        const agents = recordingAgents();
        test.module.beforeStart(test.database.context, agents.ref);
        try {
            await test.module.setGoal(test.database.context, "agent-a", "one");
            await test.module.setGoal(test.database.context, "agent-b", "two");

            await expect(test.module.goal(test.database.context, "agent-a")).resolves.toMatchObject(
                {
                    objective: "one",
                },
            );
            await expect(test.module.goal(test.database.context, "agent-b")).resolves.toMatchObject(
                {
                    objective: "two",
                },
            );
            await test.module.clearGoal(test.database.context, "agent-a");
            await expect(
                test.module.goal(test.database.context, "agent-a"),
            ).resolves.toBeUndefined();
            await expect(test.module.goal(test.database.context, "agent-b")).resolves.toMatchObject(
                {
                    objective: "two",
                },
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects an active goal without its exact lifecycle sidecar", async () => {
        const test = newDatabase("goal-state-missing-lifecycle-test");
        await test.database.ready;
        try {
            await writeGoal(test.database.context, goalKV("agent-a"), activeGoal);

            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                "exact lifecycle sidecar",
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects an active goal whose lifecycle sidecar has different goal content", async () => {
        const test = newDatabase("goal-state-mismatched-lifecycle-test");
        await test.database.ready;
        try {
            await writeGoal(test.database.context, goalKV("agent-a"), activeGoal);
            await writeGoalLifecycle(test.database.context, goalKV("agent-a"), {
                activation: "agent",
                id: "lifecycle-a",
                goal: { ...activeGoal, objective: "different" },
            });

            await expect(
                readGoalAuthoritativeState(test.database.context, goalKV("agent-a"), "agent-a"),
            ).rejects.toThrow("exact lifecycle sidecar");
        } finally {
            test.database.close();
        }
    });

    it("rejects inactive goals that retain lifecycle or failure state", async () => {
        const test = newDatabase("goal-state-inactive-sidecars-test");
        await test.database.ready;
        try {
            const paused = { ...activeGoal, status: "paused" as const, updatedAt: 20 };
            await writeGoal(test.database.context, goalKV("agent-a"), paused);
            await writeGoalLifecycle(test.database.context, goalKV("agent-a"), {
                activation: "agent",
                id: "lifecycle-a",
                goal: activeGoal,
            });

            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                "inactive Goal retains active-lifecycle state",
            );

            await goalKV("agent-a").delete(test.database.context, GOAL_LIFECYCLE_KEY);
            await goalKV("agent-a").write(test.database.context, GOAL_FAILURE_COUNT_KEY, 1);
            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                "inactive Goal retains active-lifecycle state",
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects an invalid active failure count at the persistence boundary", async () => {
        const test = newDatabase("goal-state-failure-count-test");
        await test.database.ready;
        try {
            await writeGoal(test.database.context, goalKV("agent-a"), activeGoal);
            await writeGoalLifecycle(test.database.context, goalKV("agent-a"), {
                activation: "agent",
                id: "lifecycle-a",
                goal: activeGoal,
            });
            await goalKV("agent-a").write(
                test.database.context,
                GOAL_FAILURE_COUNT_KEY,
                FAILED_TURNS_BEFORE_BLOCKED,
            );

            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                "failure count is invalid",
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects malformed JSON instead of treating corrupt durable state as absent", async () => {
        const test = newDatabase("goal-state-malformed-json-test");
        await test.database.ready;
        try {
            await agentDatabaseRun(
                test.database.database,
                sql`INSERT INTO happy_agent_goal_state (agent_id, state_key, value_json)
                    VALUES (${"agent-a"}, ${GOAL_KEY}, ${"{not-json"})`,
            );

            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                /JSON|position|Unexpected/,
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects invalid persisted goal semantics", async () => {
        const test = newDatabase("goal-state-invalid-semantics-test");
        await test.database.ready;
        try {
            await goalKV("agent-a").write(test.database.context, GOAL_KEY, {
                ...activeGoal,
                createdAt: 30,
                updatedAt: 29,
            });

            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                "invalid timestamps",
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects malformed lifecycle JSON and unexpected goal properties", async () => {
        const test = newDatabase("goal-state-invalid-lifecycle-test");
        await test.database.ready;
        try {
            await goalKV("agent-a").write(test.database.context, GOAL_KEY, {
                ...activeGoal,
                unexpected: true,
            });
            await goalKV("agent-a").write(test.database.context, GOAL_LIFECYCLE_KEY, {
                activation: "bogus",
                id: "lifecycle-a",
                goal: activeGoal,
            });

            await expect(test.module.goal(test.database.context, "agent-a")).rejects.toThrow(
                /stored goal is invalid|lifecycle sidecar is invalid/,
            );
        } finally {
            test.database.close();
        }
    });

    it("rejects invalid public identities before touching storage", async () => {
        const test = newDatabase("goal-invalid-identities-test");
        await test.database.ready;
        try {
            await expect(test.module.goal(test.database.context, "")).rejects.toThrow(
                "agent ID is invalid",
            );
            await expect(
                test.module.clearGoal(test.database.context, "x".repeat(257)),
            ).rejects.toThrow("agent ID is invalid");
            await expect(
                readGoalAuthoritativeState(test.database.context, goalKV("agent-a"), ""),
            ).rejects.toThrow("agent ID is invalid");
        } finally {
            test.database.close();
        }
    });
});
