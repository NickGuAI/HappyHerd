import { withAgentContext } from "@slopus/happy-agent-base";
import { describe, expect, it } from "vitest";
import type { Context } from "@steve.kite/stdlib";

import { GoalModule } from "../../sources/goal/GoalModule.js";
import { moduleDatabase } from "../support/moduleDatabase.js";
import { recordingAgents } from "./recordingAgents.js";

function ownerContext(context: Context, agentId: string): Context {
    return withAgentContext(context, {
        id: agentId,
        provider: "scripted",
        permissionMode: "auto",
    });
}

describe("Goal stopping the work behind a goal", () => {
    it("takes no construction arguments", () => {
        expect(GoalModule.length).toBe(0);
        const module = new GoalModule();
        expect(module.name).toBe("goal");
    });

    it("stops the owning agent when someone outside it pauses, blocks, or clears the goal", async () => {
        for (const [name, status] of [
            ["goal-abort-paused-test", "paused"],
            ["goal-abort-blocked-test", "blocked"],
        ] as const) {
            const module = new GoalModule();
            const database = moduleDatabase(module.migrations, name);
            await database.ready;
            const agents = recordingAgents();
            module.beforeStart(database.context, agents.ref);
            try {
                // An external caller: the context names no agent, so it is not the owner.
                await module.setGoal(database.context, "agent-a", "ship it");
                expect(agents.aborts).toEqual([]);

                await module.changeGoalStatus(database.context, "agent-a", status);
                await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                    status,
                });
                expect(agents.aborts).toEqual(["agent-a"]);
            } finally {
                database.close();
            }
        }

        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-abort-cleared-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            await module.setGoal(database.context, "agent-a", "ship it");
            await expect(module.clearGoal(database.context, "agent-a")).resolves.toBe(true);
            expect(agents.aborts).toEqual(["agent-a"]);
        } finally {
            database.close();
        }
    });

    it("never stops an agent that changed its own goal", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-abort-self-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            const ctx = ownerContext(database.context, "agent-a");
            await module.setGoal(ctx, "agent-a", "ship it");
            await module.changeGoalStatus(ctx, "agent-a", "paused");
            await module.changeGoalStatus(ctx, "agent-a", "active");
            await module.clearGoal(ctx, "agent-a");

            // Aborting here would cancel the very turn that asked.
            expect(agents.aborts).toEqual([]);
        } finally {
            database.close();
        }
    });

    it("does not stop an agent when the transition rolls back", async () => {
        const module = new GoalModule();
        module.onEventTransactional((_ctx, event) => {
            if (event.type === "goal_cleared") throw new Error("reject clear");
        });
        const database = moduleDatabase(module.migrations, "goal-abort-rollback-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            await module.setGoal(database.context, "agent-a", "ship it");
            await expect(module.clearGoal(database.context, "agent-a")).rejects.toThrow(
                "reject clear",
            );
            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                status: "active",
            });
            expect(agents.aborts).toEqual([]);
        } finally {
            database.close();
        }
    });

    it("keeps the committed transition when stopping the agent fails", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-abort-failure-test");
        await database.ready;
        const agents = recordingAgents(undefined, () => {
            throw new Error("abort failed");
        });
        module.beforeStart(database.context, agents.ref);
        try {
            await module.setGoal(database.context, "agent-a", "ship it");
            await expect(
                module.changeGoalStatus(database.context, "agent-a", "blocked"),
            ).resolves.toMatchObject({ status: "blocked" });
            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                status: "blocked",
            });
            expect(agents.aborts).toEqual(["agent-a"]);
        } finally {
            database.close();
        }
    });

    it("works without an agent system when the mutation comes from the owning agent", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-abort-no-system-test");
        await database.ready;
        try {
            const ctx = ownerContext(database.context, "agent-a");
            await module.setGoal(ctx, "agent-a", "ship it");
            await expect(module.changeGoalStatus(ctx, "agent-a", "paused")).resolves.toMatchObject({
                status: "paused",
            });
        } finally {
            database.close();
        }
    });
});
