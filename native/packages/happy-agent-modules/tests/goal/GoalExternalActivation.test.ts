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

describe("Goal external activation", () => {
    it("wakes an external agent with durable identity and untrusted provenance metadata", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-external-wake-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            await module.setGoal(database.context, "agent-a", "ship it");

            expect(agents.wakes).toHaveLength(1);
            expect(agents.wakes[0]).toMatchObject({
                agentId: "agent-a",
                text: expect.stringContaining("ship it"),
                metadata: {
                    messageOrigin: "agent",
                    senderAgentId: "agent-a",
                },
            });
            expect(agents.wakes[0]?.id).toMatch(/^g[a-z0-9]{31}$/);

            await module.setGoal(database.context, "agent-a", "  ship it  ");
            expect(agents.wakes).toHaveLength(1);
        } finally {
            database.close();
        }
    });

    it("does not wake an owning agent for an in-agent activation", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-internal-activation-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            await module.setGoal(ownerContext(database.context, "agent-a"), "agent-a", "ship it");
            expect(agents.wakes).toEqual([]);
        } finally {
            database.close();
        }
    });

    it("rolls back external activation when the host send rejects", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-external-wake-failure-test");
        await database.ready;
        const agents = recordingAgents(async () => {
            throw new Error("send failed");
        });
        module.beforeStart(database.context, agents.ref);
        try {
            await expect(module.setGoal(database.context, "agent-a", "ship it")).rejects.toThrow(
                "send failed",
            );
            await expect(module.goal(database.context, "agent-a")).resolves.toBeUndefined();
            expect(agents.wakes).toEqual([]);
        } finally {
            database.close();
        }
    });

    it("requires the system reference for external activation", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-external-without-system-test");
        await database.ready;
        try {
            await expect(module.setGoal(database.context, "agent-a", "ship it")).rejects.toThrow(
                "requires the agent system",
            );
            await expect(module.goal(database.context, "agent-a")).resolves.toBeUndefined();
        } finally {
            database.close();
        }
    });

    it("uses a new lifecycle and wake when resuming a paused external goal", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-external-resume-test");
        await database.ready;
        const agents = recordingAgents();
        module.beforeStart(database.context, agents.ref);
        try {
            await module.setGoal(database.context, "agent-a", "ship it");
            await module.changeGoalStatus(database.context, "agent-a", "paused");
            await module.changeGoalStatus(database.context, "agent-a", "active");

            expect(agents.wakes).toHaveLength(2);
            expect(agents.wakes[1]).toMatchObject({
                agentId: "agent-a",
                metadata: {
                    messageOrigin: "agent",
                    senderAgentId: "agent-a",
                },
            });
            expect(agents.wakes[1]?.id).not.toBe(agents.wakes[0]?.id);
        } finally {
            database.close();
        }
    });
});
