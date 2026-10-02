import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SchedulingEvent } from "../../sources/scheduling/SchedulingEvent.js";
import { SCHEDULING_OUTPUT_CHARACTERS } from "../../sources/scheduling/SchedulingModule.js";
import { schedulePageText } from "../../sources/scheduling/schedulingFormat.js";
import {
    advance,
    armedAlarms,
    schedulingHarness,
    settle,
    START_TIME,
    useSchedulingClock,
} from "./support/schedulingHarness.js";

const sender = "agenta";
const recipient = "agentb";

describe("Scheduled messages", () => {
    beforeEach(() => {
        useSchedulingClock();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("delivers a message itself when its time comes and records that it arrived", async () => {
        const harness = await schedulingHarness("message-delivered");
        try {
            const scheduled = await harness.module.schedule(harness.database.context, sender, {
                id: "messageone",
                targetAgentId: recipient,
                message: "Check the release",
                in: { minutes: 5 },
            });
            expect(scheduled).toMatchObject({ status: "pending", dueAt: START_TIME + 300_000 });
            expect(harness.agents.delivered).toEqual([]);

            await advance(5 * 60_000);

            expect(harness.agents.delivered).toEqual([
                {
                    agentId: recipient,
                    id: "messageone",
                    text: "A message agent agenta scheduled for now:\n\nCheck the release",
                    metadata: {
                        scheduling: {
                            scheduleId: "messageone",
                            senderAgentId: sender,
                            targetAgentId: recipient,
                        },
                        senderAgentId: sender,
                    },
                },
            ]);
            const settled = await harness.module.getSchedule(
                harness.database.context,
                sender,
                "messageone",
            );
            expect(settled).toMatchObject({
                status: "delivered",
                deliveredAt: START_TIME + 300_000,
            });
        } finally {
            harness.close();
        }
    });

    it("addresses a message to the sender itself", async () => {
        const harness = await schedulingHarness("message-to-self");
        try {
            await harness.module.schedule(harness.database.context, sender, {
                id: "messageself",
                message: "Remember the deploy",
                in: { seconds: 30 },
            });
            await advance(30_000);

            expect(harness.agents.delivered[0]).toMatchObject({
                agentId: sender,
                text: "A message you scheduled for now:\n\nRemember the deploy",
            });
        } finally {
            harness.close();
        }
    });

    it("keeps an undelivered message with its sender, with the reason it failed", async () => {
        const harness = await schedulingHarness("message-undelivered");
        try {
            harness.agents.failNextDeliveries("That agent has been closed.");
            await harness.module.schedule(harness.database.context, sender, {
                id: "messagefail",
                targetAgentId: recipient,
                message: "Check the release",
                in: { seconds: 10 },
            });
            await advance(10_000);

            expect(
                await harness.module.getSchedule(harness.database.context, sender, "messagefail"),
            ).toMatchObject({
                status: "undelivered",
                failure: "That agent has been closed.",
                senderAgentId: sender,
            });
        } finally {
            harness.close();
        }
    });

    it("cancels a message before it leaves, and never delivers it", async () => {
        const harness = await schedulingHarness("message-cancelled");
        try {
            await harness.module.schedule(harness.database.context, sender, {
                id: "messagestop",
                message: "Never mind",
                in: { minutes: 1 },
            });
            const cancelled = await harness.module.cancelSchedule(
                harness.database.context,
                sender,
                { scheduleId: "messagestop" },
            );
            expect(cancelled.status).toBe("cancelled");
            expect(armedAlarms()).toBe(0);

            await advance(60_000);
            expect(harness.agents.delivered).toEqual([]);
            expect(harness.module.formatCancellationForModel(cancelled)).toBe(
                "Message messagestop is now cancelled before delivery.",
            );
        } finally {
            harness.close();
        }
    });

    it("leaves a delivered message delivered when a cancellation arrives late", async () => {
        const harness = await schedulingHarness("message-cancel-late");
        try {
            await harness.module.schedule(harness.database.context, sender, {
                id: "messagelate",
                message: "Already gone",
                in: { seconds: 1 },
            });
            await advance(1_000);

            expect(
                await harness.module.cancelSchedule(harness.database.context, sender, {
                    scheduleId: "messagelate",
                }),
            ).toMatchObject({ status: "delivered" });
            expect(harness.agents.delivered).toHaveLength(1);
        } finally {
            harness.close();
        }
    });

    it("arms everything left pending when the process starts again", async () => {
        const first = await schedulingHarness("message-recovered");
        try {
            await first.module.schedule(first.database.context, sender, {
                id: "messagelives",
                targetAgentId: recipient,
                message: "Survives a restart",
                in: { minutes: 10 },
            });
            first.module.stop();
            expect(armedAlarms()).toBe(0);

            const second = await schedulingHarness("message-recovered", {
                agents: first.agents,
                database: first.database,
            });
            expect(armedAlarms()).toBe(1);

            await advance(10 * 60_000);
            expect(second.agents.delivered).toHaveLength(1);
            expect(
                await second.module.getSchedule(second.database.context, sender, "messagelives"),
            ).toMatchObject({ status: "delivered" });
        } finally {
            first.close();
        }
    });

    it("delivers a message the recipient is waiting for, and ends that wait", async () => {
        const harness = await schedulingHarness("message-ends-wait");
        try {
            await harness.module.schedule(harness.database.context, sender, {
                id: "messagewake",
                targetAgentId: recipient,
                message: "Wake up",
                in: { seconds: 30 },
            });
            const waiting = harness.module.wait(harness.database.context, recipient, {
                id: "waitforit",
                duration: { hours: 2 },
            });
            await settle();

            await advance(30_000);

            expect(await waiting).toMatchObject({ outcome: "interrupted", elapsedMs: 30_000 });
        } finally {
            harness.close();
        }
    });

    it("treats the same durable call as one message, not two", async () => {
        const harness = await schedulingHarness("message-replay");
        try {
            const first = await harness.module.schedule(harness.database.context, sender, {
                id: "messageonce",
                message: "Only once",
                in: { seconds: 20 },
            });
            const replayed = await harness.module.schedule(harness.database.context, sender, {
                id: "messageonce",
                message: "Only once",
                in: { seconds: 20 },
            });

            expect(replayed).toEqual(first);
            await advance(20_000);
            expect(harness.agents.delivered).toHaveLength(1);
        } finally {
            harness.close();
        }
    });

    it("mints its own message identity when a caller does not supply one", async () => {
        const harness = await schedulingHarness("message-generated-id");
        try {
            const first = await harness.module.schedule(harness.database.context, sender, {
                message: "One",
                in: { seconds: 20 },
            });
            const second = await harness.module.schedule(harness.database.context, sender, {
                message: "Two",
                in: { seconds: 20 },
            });

            expect(first.id).toMatch(/^[a-z][a-z0-9]{1,31}$/);
            expect(second.id).not.toBe(first.id);
        } finally {
            harness.close();
        }
    });

    it("shows an agent only its own messages, and lets only the sender cancel one", async () => {
        const harness = await schedulingHarness("message-ownership");
        try {
            await harness.module.schedule(harness.database.context, sender, {
                id: "messagemine",
                targetAgentId: recipient,
                message: "From A",
                in: { minutes: 1 },
            });
            await harness.module.schedule(harness.database.context, recipient, {
                id: "messageyours",
                message: "From B",
                in: { minutes: 1 },
            });

            const page = await harness.module.listSchedulePage(harness.database.context, sender);
            expect(page.schedules.map((schedule) => schedule.id)).toEqual(["messagemine"]);
            // The recipient may read a message addressed to it, but not withdraw it.
            expect(
                await harness.module.getSchedule(
                    harness.database.context,
                    recipient,
                    "messagemine",
                ),
            ).toMatchObject({ id: "messagemine" });
            await expect(
                harness.module.cancelSchedule(harness.database.context, recipient, {
                    scheduleId: "messagemine",
                }),
            ).rejects.toThrow("does not exist");
        } finally {
            harness.close();
        }
    });

    it("gives every subscriber the same frozen event, before and after the commit", async () => {
        const transactional: SchedulingEvent[] = [];
        const postCommit: SchedulingEvent[] = [];
        const second: SchedulingEvent[] = [];
        const harness = await schedulingHarness("message-events");
        const stopTransactional = harness.module.onEventTransactional((_ctx, event) => {
            transactional.push(event);
        });
        harness.module.onEvent((_ctx, event) => {
            postCommit.push(event);
        });
        const stopSecond = harness.module.onEvent((_ctx, event) => {
            second.push(event);
        });
        try {
            await harness.module.schedule(harness.database.context, sender, {
                id: "messageseen",
                message: "Observed",
                in: { seconds: 5 },
            });
            await advance(5_000);

            expect(transactional.map((event) => event.type)).toEqual([
                "message_scheduled",
                "scheduled_message_delivery_outcome",
            ]);
            expect(postCommit).toEqual(transactional);
            expect(second).toEqual(transactional);
            expect(Object.isFrozen(transactional[0])).toBe(true);

            // Unsubscribing stops exactly that subscriber and leaves the others alone.
            stopTransactional();
            stopSecond();
            await harness.module.schedule(harness.database.context, sender, {
                id: "messageafter",
                message: "Only the remaining subscriber sees this",
                in: { seconds: 5 },
            });
            expect(transactional).toHaveLength(2);
            expect(second).toHaveLength(2);
            expect(postCommit).toHaveLength(3);
        } finally {
            harness.close();
        }
    });

    it("keeps working when a post-commit subscriber throws", async () => {
        const seen: string[] = [];
        const harness = await schedulingHarness("message-subscriber-failure");
        harness.module.onEvent(() => {
            throw new Error("subscriber failed");
        });
        harness.module.onEvent((_ctx, event) => {
            seen.push(event.type);
        });
        try {
            await expect(
                harness.module.schedule(harness.database.context, sender, {
                    id: "messagesurvives",
                    message: "Committed anyway",
                    in: { seconds: 5 },
                }),
            ).resolves.toMatchObject({ status: "pending" });
            await settle();

            expect(seen).toEqual(["message_scheduled"]);
            expect(
                await harness.module.getSchedule(
                    harness.database.context,
                    sender,
                    "messagesurvives",
                ),
            ).toMatchObject({ status: "pending" });
        } finally {
            harness.close();
        }
    });

    it("rejects the mutation when a transactional subscriber throws", async () => {
        const harness = await schedulingHarness("message-transactional-failure");
        harness.module.onEventTransactional(() => {
            throw new Error("reject this schedule");
        });
        try {
            await expect(
                harness.module.schedule(harness.database.context, sender, {
                    id: "messagerejected",
                    message: "Never stored",
                    in: { seconds: 5 },
                }),
            ).rejects.toThrow("reject this schedule");
            expect(
                await harness.module.getSchedule(
                    harness.database.context,
                    sender,
                    "messagerejected",
                ),
            ).toBeUndefined();
        } finally {
            harness.close();
        }
    });

    it("trims a page to the output budget without stepping over a message", async () => {
        const harness = await schedulingHarness("message-page");
        try {
            for (let index = 0; index < 6; index += 1) {
                await harness.module.schedule(harness.database.context, sender, {
                    id: `messagepage${index}`,
                    targetAgentId: recipient,
                    message: `Message ${index}`,
                    in: { minutes: index + 1 },
                });
            }

            const page = await harness.module.listSchedulePage(harness.database.context, sender);
            const trimmed = schedulePageText(page, 256);
            const shown = trimmed.text.split("\n").filter((line) => line.startsWith("messagepage"));

            expect(trimmed.text.length).toBeLessThanOrEqual(256);
            expect(shown.length).toBeGreaterThan(0);
            expect(shown.length).toBeLessThan(6);
            expect(trimmed.text).toContain(`More messages start at cursor ${shown.length}.`);
        } finally {
            harness.close();
        }
    });

    it("keeps a full page of messages inside the module's own output budget", async () => {
        const harness = await schedulingHarness("message-page-budget");
        try {
            for (let index = 0; index < 6; index += 1) {
                await harness.module.schedule(harness.database.context, sender, {
                    id: `messagebudget${index}`,
                    targetAgentId: recipient,
                    message: `Message ${index}`,
                    in: { minutes: index + 1 },
                });
            }

            const page = await harness.module.listSchedulePage(harness.database.context, sender);
            const text = harness.module.formatSchedulePageForModel(page);

            expect(text.length).toBeLessThanOrEqual(SCHEDULING_OUTPUT_CHARACTERS);
            expect(text.split("\n")).toHaveLength(6);
        } finally {
            harness.close();
        }
    });

    it("refuses a message further away than the horizon allows", async () => {
        const harness = await schedulingHarness("message-horizon");
        try {
            await expect(
                harness.module.schedule(harness.database.context, sender, {
                    id: "messagefar",
                    message: "Too far",
                    in: { days: 3 },
                }),
            ).rejects.toThrow("longer than the 1 day limit");
        } finally {
            harness.close();
        }
    });

    it("has no options, scheduler, authorization, or delivery-reporting surface left", async () => {
        const exports = await import("../../sources/scheduling/index.js");
        expect("schedulingSchedulerSchema" in exports).toBe(false);
        expect("schedulingAuthorizationSchema" in exports).toBe(false);
        expect("schedulingDeliveryOutcomeInputSchema" in exports).toBe(false);
        expect("schedulingModuleOptionsSchema" in exports).toBe(false);
        expect("schedulingClockSchema" in exports).toBe(false);
        expect("schedulingTimersSchema" in exports).toBe(false);
        expect(exports.SchedulingModule.length).toBe(0);
    });
});
