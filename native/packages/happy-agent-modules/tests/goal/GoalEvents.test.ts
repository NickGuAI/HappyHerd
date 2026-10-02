import { withAgentContext } from "@slopus/happy-agent-base";
import { describe, expect, it } from "vitest";
import type { Context } from "@steve.kite/stdlib";

import { GoalModule } from "../../sources/goal/GoalModule.js";
import type { GoalEvent } from "../../sources/goal/GoalEvent.js";
import { moduleDatabase } from "../support/moduleDatabase.js";

function ownerContext(context: Context, agentId: string): Context {
    return withAgentContext(context, {
        id: agentId,
        provider: "scripted",
        permissionMode: "auto",
    });
}

describe("Goal events and transaction boundaries", () => {
    it("delivers one deeply frozen event to both kinds of subscriber with stable identity", async () => {
        let transactionalEvent: GoalEvent | undefined;
        let postCommitEvent: GoalEvent | undefined;
        const module = new GoalModule();
        module.onEventTransactional((_ctx, event) => {
            transactionalEvent = event;
            expect(Object.isFrozen(event)).toBe(true);
            if (event.type === "goal_set") {
                expect(Object.isFrozen(event.goal)).toBe(true);
            }
        });
        module.onEvent((_ctx, event) => {
            postCommitEvent = event;
            expect(Object.isFrozen(event)).toBe(true);
            if (event.type === "goal_set") {
                expect(Object.isFrozen(event.goal)).toBe(true);
            }
        });
        const database = moduleDatabase(module.migrations, "goal-event-identity-test");
        await database.ready;
        try {
            const before = Date.now();
            await module.setGoal(ownerContext(database.context, "agent-a"), "agent-a", "ship it");

            expect(postCommitEvent).toBe(transactionalEvent);
            expect(transactionalEvent).toMatchObject({
                type: "goal_set",
                agentId: "agent-a",
            });
            // Identity and time are the module's own.
            expect(transactionalEvent?.eventId.length).toBeGreaterThan(0);
            expect(transactionalEvent?.at).toBeGreaterThanOrEqual(before);
            expect(transactionalEvent?.at).toBeLessThanOrEqual(Date.now());
        } finally {
            database.close();
        }
    });

    it("gives every subscriber the same event and stops delivering after unsubscribe", async () => {
        const module = new GoalModule();
        const first: string[] = [];
        const second: string[] = [];
        module.onEvent((_ctx, event) => {
            first.push(event.type);
        });
        const unsubscribe = module.onEvent((_ctx, event) => {
            second.push(event.type);
        });
        const database = moduleDatabase(module.migrations, "goal-event-subscribers-test");
        await database.ready;
        try {
            const ctx = ownerContext(database.context, "agent-a");
            await module.setGoal(ctx, "agent-a", "ship it");
            expect(first).toEqual(["goal_set"]);
            expect(second).toEqual(["goal_set"]);

            unsubscribe();
            unsubscribe(); // Unsubscribing twice does nothing further.
            await module.clearGoal(ctx, "agent-a");
            expect(first).toEqual(["goal_set", "goal_cleared"]);
            expect(second).toEqual(["goal_set"]);
        } finally {
            database.close();
        }
    });

    it("rejects a subscriber that is not a function", () => {
        const module = new GoalModule();
        expect(() => module.onEvent({} as never)).toThrow();
        expect(() => module.onEventTransactional({} as never)).toThrow();
    });

    it("does not publish post-commit events or durable state after an outer rollback", async () => {
        const transactionalEvents: string[] = [];
        const postCommitEvents: string[] = [];
        const module = new GoalModule();
        module.onEventTransactional((_ctx, event) => {
            transactionalEvents.push(event.type);
        });
        module.onEvent((_ctx, event) => {
            postCommitEvents.push(event.type);
        });
        const database = moduleDatabase(module.migrations, "goal-event-rollback-test");
        await database.ready;
        try {
            const ctx = ownerContext(database.context, "agent-a");
            await expect(
                ctx.inTx(async (txCtx) => {
                    await module.setGoal(txCtx, "agent-a", "ship it");
                    throw new Error("outer rollback");
                }),
            ).rejects.toThrow("outer rollback");

            expect(transactionalEvents).toEqual(["goal_set"]);
            expect(postCommitEvents).toEqual([]);
            await expect(module.goal(database.context, "agent-a")).resolves.toBeUndefined();
        } finally {
            database.close();
        }
    });

    it("rolls the mutation back when a transactional subscriber throws", async () => {
        const module = new GoalModule();
        module.onEventTransactional(() => {
            throw new Error("reject goal");
        });
        const database = moduleDatabase(module.migrations, "goal-event-transactional-throw-test");
        await database.ready;
        try {
            await expect(
                module.setGoal(ownerContext(database.context, "agent-a"), "agent-a", "ship it"),
            ).rejects.toThrow("reject goal");
            await expect(module.goal(database.context, "agent-a")).resolves.toBeUndefined();
        } finally {
            database.close();
        }
    });

    it("contains post-commit subscriber failures and keeps the committed goal", async () => {
        const module = new GoalModule();
        const survivors: string[] = [];
        module.onEvent(() => {
            throw new Error("post-commit observer failed");
        });
        module.onEvent((_ctx, event) => {
            survivors.push(event.type);
        });
        const database = moduleDatabase(module.migrations, "goal-event-observer-error-test");
        await database.ready;
        try {
            await module.setGoal(ownerContext(database.context, "agent-a"), "agent-a", "ship it");

            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                status: "active",
            });
            // The failure did not stop the later subscriber.
            expect(survivors).toEqual(["goal_set"]);
        } finally {
            database.close();
        }
    });

    it("mints a distinct identity for every event it publishes", async () => {
        const module = new GoalModule();
        const eventIds: string[] = [];
        module.onEvent((_ctx, event) => {
            eventIds.push(event.eventId);
        });
        const database = moduleDatabase(module.migrations, "goal-event-identity-unique-test");
        await database.ready;
        try {
            const ctx = ownerContext(database.context, "agent-a");
            await module.setGoal(ctx, "agent-a", "ship it");
            await module.changeGoalStatus(ctx, "agent-a", "paused");
            await module.clearGoal(ctx, "agent-a");

            expect(eventIds).toHaveLength(3);
            expect(new Set(eventIds).size).toBe(3);
        } finally {
            database.close();
        }
    });
});
