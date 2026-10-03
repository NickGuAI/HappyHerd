import { sql } from "drizzle-orm";
import { agentDatabaseRun } from "@slopus/happy-agent-base";
import { describe, expect, it } from "vitest";

import {
    createPresenceDatabase,
    presenceMigrations,
} from "../../sources/presence/PresenceDatabase.js";
import { ONLINE_PRESENCE_ID } from "../../sources/presence/PresenceCatalog.js";
import type { PresenceStoredState } from "../../sources/presence/PresenceState.js";
import { moduleDatabase } from "../support/moduleDatabase.js";

function schedule(overrides: Record<string, unknown> = {}) {
    return {
        days: [1],
        startTime: "09:00",
        endTime: "17:00",
        timeZone: "UTC",
        presence: { status: "away" as const },
        ...overrides,
    };
}

describe("presence database", () => {
    it("reads configured state at exact effective and expiry boundaries", async () => {
        const test = moduleDatabase(presenceMigrations, "presence-db-boundaries");
        await test.ready;
        try {
            const database = createPresenceDatabase();
            const configured: PresenceStoredState = {
                presenceId: "away",
                message: "back soon",
                effectiveFrom: 100,
                expiresAt: 200,
                fallbackPresenceId: ONLINE_PRESENCE_ID,
            };
            await database.set(test.context, configured);

            await expect(database.read(test.context, 99)).resolves.toBeUndefined();
            await expect(database.read(test.context, 100)).resolves.toEqual(configured);
            await expect(database.read(test.context, 199)).resolves.toEqual(configured);
            await expect(database.read(test.context, 200)).resolves.toEqual({
                presenceId: "online",
                effectiveFrom: 200,
            });
            await expect(database.read(test.context, 201)).resolves.toEqual({
                presenceId: "online",
                effectiveFrom: 200,
            });

            const detached = await database.readConfigured(test.context);
            if (detached === undefined) throw new Error("Expected configured state.");
            detached.message = "caller mutation";
            await expect(database.readConfigured(test.context)).resolves.toEqual(configured);
        } finally {
            test.close();
        }
    });

    it("returns no effective state after an expiry without fallback and lets schedules take over after clear", async () => {
        const test = moduleDatabase(presenceMigrations, "presence-db-schedule-fallback");
        await test.ready;
        try {
            const database = createPresenceDatabase();
            await database.set(test.context, {
                presenceId: "away",
                expiresAt: 200,
            });
            await expect(database.read(test.context, 200)).resolves.toBeUndefined();

            await database.schedules.set(test.context, schedule(), "schedule-a");
            await expect(
                database.read(test.context, Date.parse("2024-01-01T10:00:00Z")),
            ).resolves.toBeUndefined();
            await database.clear(test.context);
            await expect(
                database.read(test.context, Date.parse("2024-01-01T10:00:00Z")),
            ).resolves.toEqual({
                presenceId: "away",
            });
        } finally {
            test.close();
        }
    });

    it("normalizes only through the module, while the database preserves schedule records and IDs", async () => {
        const test = moduleDatabase(presenceMigrations, "presence-db-schedule-records");
        await test.ready;
        try {
            const database = createPresenceDatabase();
            const input = schedule({ days: [3, 1], presence: { status: "online" as const } });
            const stored = await database.schedules.set(test.context, input, "schedule-z");
            expect(stored).toEqual({ id: "schedule-z", ...input });
            const listed = await database.schedules.list(test.context, { limit: 1 });
            expect(listed).toEqual([stored]);
            listed[0]!.days.reverse();
            await expect(database.schedules.list(test.context, { limit: 1 })).resolves.toEqual([
                stored,
            ]);
            await expect(database.schedules.clear(test.context, "missing")).resolves.toBe(false);
            await expect(database.schedules.clear(test.context, "schedule-z")).resolves.toBe(true);
            await expect(database.schedules.list(test.context, { limit: 1 })).resolves.toEqual([]);
        } finally {
            test.close();
        }
    });

    it("handles recurring windows in a timezone with start-inclusive and end-exclusive boundaries", async () => {
        const test = moduleDatabase(presenceMigrations, "presence-db-schedule-boundaries");
        await test.ready;
        try {
            const database = createPresenceDatabase();
            await database.schedules.set(
                test.context,
                schedule({
                    days: [1],
                    startTime: "09:00",
                    endTime: "17:00",
                    presence: { status: "dnd" as const },
                }),
                "daytime",
            );
            await expect(
                database.read(test.context, Date.parse("2024-01-01T08:59:00Z")),
            ).resolves.toBeUndefined();
            await expect(
                database.read(test.context, Date.parse("2024-01-01T09:00:00Z")),
            ).resolves.toEqual({ presenceId: "dnd" });
            await expect(
                database.read(test.context, Date.parse("2024-01-01T16:59:00Z")),
            ).resolves.toEqual({ presenceId: "dnd" });
            await expect(
                database.read(test.context, Date.parse("2024-01-01T17:00:00Z")),
            ).resolves.toBeUndefined();
            await expect(
                database.read(test.context, Date.parse("2024-01-02T10:00:00Z")),
            ).resolves.toBeUndefined();

            await database.schedules.set(
                test.context,
                schedule({
                    days: [1, 2],
                    startTime: "22:00",
                    endTime: "02:00",
                    presence: { status: "offline" as const },
                }),
                "overnight",
            );
            await expect(
                database.read(test.context, Date.parse("2024-01-01T23:00:00Z")),
            ).resolves.toEqual({ presenceId: "offline" });
            await expect(
                database.read(test.context, Date.parse("2024-01-02T01:59:00Z")),
            ).resolves.toEqual({ presenceId: "offline" });
            await expect(
                database.read(test.context, Date.parse("2024-01-02T02:00:00Z")),
            ).resolves.toBeUndefined();
        } finally {
            test.close();
        }
    });

    it("rejects malformed persisted JSON and schema-valid but semantically invalid records", async () => {
        const test = moduleDatabase(presenceMigrations, "presence-db-malformed");
        await test.ready;
        try {
            await agentDatabaseRun(
                test.database,
                sql`INSERT INTO happy_agent_presence (singleton_id, state_json)
                    VALUES (1, ${"{not-json"})`,
            );
            const database = createPresenceDatabase();
            await expect(database.readConfigured(test.context)).rejects.toThrow("not valid JSON");

            await agentDatabaseRun(
                test.database,
                sql`UPDATE happy_agent_presence
                    SET state_json = ${JSON.stringify({
                        presenceId: "away",
                        effectiveFrom: 200,
                        expiresAt: 100,
                    })}
                    WHERE singleton_id = 1`,
            );
            await expect(database.readConfigured(test.context)).rejects.toThrow(
                "expiry must be after",
            );

            await agentDatabaseRun(
                test.database,
                sql`INSERT INTO happy_agent_presence_schedules (id, schedule_json)
                    VALUES (${"bad-schedule"}, ${JSON.stringify({
                        id: "bad-schedule",
                        days: [2, 1],
                        startTime: "09:00",
                        endTime: "17:00",
                        timeZone: "UTC",
                        presence: { status: "away" },
                    })})`,
            );
            await expect(
                database.schedules.list(test.context, { limit: 10 }),
            ).resolves.toHaveLength(1);
        } finally {
            test.close();
        }
    });

    it("rejects invalid catalog and schedule JSON at their storage boundary", async () => {
        const test = moduleDatabase(presenceMigrations, "presence-db-invalid-json");
        await test.ready;
        try {
            await agentDatabaseRun(
                test.database,
                sql`INSERT INTO happy_agent_presence_catalog (id, definition_json)
                    VALUES (${"bad"}, ${"{broken"})`,
            );
            const database = createPresenceDatabase();
            await expect(database.catalog.list(test.context, { limit: 10 })).rejects.toThrow(
                "not valid JSON",
            );

            await agentDatabaseRun(
                test.database,
                sql`INSERT INTO happy_agent_presence_schedules (id, schedule_json)
                    VALUES (${"bad-shape"}, ${JSON.stringify({
                        id: "bad-shape",
                        days: [1],
                        startTime: "09:00",
                        endTime: "17:00",
                        timeZone: "UTC",
                        presence: { status: "not-a-status" },
                    })})`,
            );
            await expect(database.schedules.list(test.context, { limit: 10 })).rejects.toThrow(
                "invalid schedule",
            );
        } finally {
            test.close();
        }
    });
});
