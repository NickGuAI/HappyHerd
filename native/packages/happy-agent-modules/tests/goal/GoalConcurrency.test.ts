import { withAgentContext } from "@slopus/happy-agent-base";
import { describe, expect, it } from "vitest";
import type { Context } from "@steve.kite/stdlib";

import { GoalModule } from "../../sources/goal/GoalModule.js";
import type { SessionGoal } from "../../sources/goal/SessionGoal.js";
import { moduleDatabase } from "../support/moduleDatabase.js";
import { recordingAgents } from "./recordingAgents.js";

function ownerContext(context: Context, agentId: string): Context {
    return withAgentContext(context, {
        id: agentId,
        provider: "scripted",
        permissionMode: "auto",
    });
}

describe("Goal concurrent public mutations", () => {
    it("serializes competing goal creation through the database transaction", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-concurrent-create-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        const ctx = ownerContext(database.context, "agent-a");
        try {
            const results = await Promise.allSettled([
                module.setGoal(ctx, "agent-a", "first"),
                module.setGoal(ctx, "agent-a", "second"),
            ]);
            const fulfilled = results.filter(
                (result): result is PromiseFulfilledResult<SessionGoal> =>
                    result.status === "fulfilled",
            );
            const rejected = results.filter((result) => result.status === "rejected");

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain(
                "unfinished goal",
            );
            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                objective: fulfilled[0]?.value.objective,
                status: "active",
            });
        } finally {
            database.close();
        }
    });

    it("allows concurrent identical activation retries to converge on one goal", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-concurrent-identical-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            // Activated from outside the agent, so each new lifecycle is visible as a wake.
            const results = await Promise.allSettled([
                module.setGoal(database.context, "agent-a", "same"),
                module.setGoal(database.context, "agent-a", "same"),
            ]);
            expect(results.every((result) => result.status === "fulfilled")).toBe(true);
            // One lifecycle, so one wake: the retry observed the first caller's committed goal.
            expect(agents.wakes).toHaveLength(1);
            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                objective: "same",
                status: "active",
            });
        } finally {
            database.close();
        }
    });
});
