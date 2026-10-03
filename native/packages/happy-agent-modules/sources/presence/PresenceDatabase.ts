import {
    agentDatabaseRows,
    agentDatabaseRun,
    type AgentModuleMigration,
} from "@slopus/happy-agent-base";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { sql } from "drizzle-orm";
import type { Context } from "@steve.kite/stdlib";

import { presenceContextSchema } from "./PresenceEvent.js";
import {
    presenceDefinitionSchema,
    type PresenceDefinition,
    presenceIdSchema,
    presenceStoredStateSchema,
    type PresenceStoredState,
    presenceTimestampSchema,
} from "./PresenceState.js";
import {
    presenceScheduleSchema,
    presenceScheduleInputSchema,
    type PresenceSchedule,
    type PresenceScheduleInput,
} from "./PresenceSchedule.js";

export const PRESENCE_MIGRATION_KEY = "001-presence";
export const PRESENCE_RECEIPTS_REMOVED_MIGRATION_KEY = "002-remove-presence-receipts";
export const PRESENCE_CATALOG_MIGRATION_KEY = "003-presence-catalog";

const PRESENCE_TABLE = "happy_agent_presence";
const SCHEDULE_TABLE = "happy_agent_presence_schedules";
const CATALOG_TABLE = "happy_agent_presence_catalog";
const presenceVoidResultSchema = Type.Promise(Type.Void());
const presenceStoredResultSchema = Type.Promise(
    Type.Union([presenceStoredStateSchema, Type.Undefined()]),
);
const presenceScheduleListSchema = Type.Promise(
    Type.Array(presenceScheduleSchema, { maxItems: 10_000 }),
);
const presenceDefinitionListSchema = Type.Promise(
    Type.Array(presenceDefinitionSchema, { maxItems: 257 }),
);
const presenceScheduleLimitSchema = Type.Integer({ minimum: 1, maximum: 10_000 });
const presenceDefinitionLimitSchema = Type.Integer({ minimum: 1, maximum: 257 });

/** Runtime contract for the module-owned database facade created below. */
export const presenceDatabaseSchema = Type.Object(
    {
        read: Type.Function(
            [presenceContextSchema, presenceTimestampSchema],
            presenceStoredResultSchema,
        ),
        readConfigured: Type.Function([presenceContextSchema], presenceStoredResultSchema),
        set: Type.Function(
            [presenceContextSchema, presenceStoredStateSchema],
            presenceVoidResultSchema,
        ),
        clear: Type.Function([presenceContextSchema], presenceVoidResultSchema),
        catalog: Type.Object(
            {
                list: Type.Function(
                    [
                        presenceContextSchema,
                        Type.Object(
                            { limit: presenceDefinitionLimitSchema },
                            { additionalProperties: false },
                        ),
                    ],
                    presenceDefinitionListSchema,
                ),
                set: Type.Function(
                    [presenceContextSchema, presenceDefinitionSchema],
                    Type.Promise(presenceDefinitionSchema),
                ),
                clear: Type.Function(
                    [presenceContextSchema, presenceIdSchema],
                    Type.Promise(Type.Boolean()),
                ),
            },
            { additionalProperties: false },
        ),
        schedules: Type.Object(
            {
                list: Type.Function(
                    [
                        presenceContextSchema,
                        Type.Object(
                            { limit: presenceScheduleLimitSchema },
                            { additionalProperties: false },
                        ),
                    ],
                    presenceScheduleListSchema,
                ),
                set: Type.Function(
                    [presenceContextSchema, presenceScheduleInputSchema, presenceIdSchema],
                    Type.Promise(presenceScheduleSchema),
                ),
                clear: Type.Function(
                    [presenceContextSchema, presenceIdSchema],
                    Type.Promise(Type.Boolean()),
                ),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type PresenceDatabase = Static<typeof presenceDatabaseSchema>;

export const presenceMigrations: readonly AgentModuleMigration[] = [
    [
        PRESENCE_MIGRATION_KEY,
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_agent_presence (
                    singleton_id INTEGER PRIMARY KEY,
                    state_json TEXT NOT NULL
                )`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_agent_presence_schedules (
                    id TEXT PRIMARY KEY,
                    schedule_json TEXT NOT NULL
                )`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_agent_presence_receipts (
                    operation_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    result_json TEXT NOT NULL
                )`,
            );
        },
    ],
    [
        PRESENCE_RECEIPTS_REMOVED_MIGRATION_KEY,
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`DROP TABLE IF EXISTS happy_agent_presence_receipts`,
            );
        },
    ],
    [
        PRESENCE_CATALOG_MIGRATION_KEY,
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS ${sql.raw(CATALOG_TABLE)} (
                    id TEXT PRIMARY KEY,
                    definition_json TEXT NOT NULL
                )`,
            );
        },
    ],
];

export function createPresenceDatabase(): PresenceDatabase {
    const readConfigured = async (ctx: Context): Promise<PresenceStoredState | undefined> => {
        const rows = await agentDatabaseRows<{ state_json: string }>(
            ctx.db,
            sql`SELECT state_json FROM ${sql.raw(PRESENCE_TABLE)}
                WHERE singleton_id = 1 LIMIT 1`,
        );
        if (rows[0] === undefined) return undefined;
        const value = parseJson(rows[0].state_json, "presence state");
        if (!Value.Check(presenceStoredStateSchema, value)) {
            throw new Error("Presence database contains an invalid configured state.");
        }
        assertStoredTimeOrder(value);
        return structuredClone(value) as PresenceStoredState;
    };

    const listCatalog = async (
        ctx: Context,
        options: { readonly limit: number },
    ): Promise<PresenceDefinition[]> => {
        const rows = await agentDatabaseRows<{ definition_json: string }>(
            ctx.db,
            sql`SELECT definition_json FROM ${sql.raw(CATALOG_TABLE)}
                ORDER BY id LIMIT ${options.limit}`,
        );
        return rows.map((row) => {
            const value = parseJson(row.definition_json, "presence definition");
            if (!Value.Check(presenceDefinitionSchema, value)) {
                throw new Error("Presence database contains an invalid presence definition.");
            }
            return structuredClone(value) as PresenceDefinition;
        });
    };

    const listSchedules = async (
        ctx: Context,
        options: { readonly limit: number },
    ): Promise<PresenceSchedule[]> => {
        const rows = await agentDatabaseRows<{ schedule_json: string }>(
            ctx.db,
            sql`SELECT schedule_json FROM ${sql.raw(SCHEDULE_TABLE)}
                ORDER BY id LIMIT ${options.limit}`,
        );
        return rows.map((row) => {
            const value = parseJson(row.schedule_json, "presence schedule");
            if (!Value.Check(presenceScheduleSchema, value)) {
                throw new Error("Presence database contains an invalid schedule.");
            }
            return structuredClone(value) as PresenceSchedule;
        });
    };

    const catalog = {
        list: listCatalog,
        set: async (ctx: Context, definition: PresenceDefinition): Promise<PresenceDefinition> => {
            if (!Value.Check(presenceDefinitionSchema, definition)) {
                throw new Error("Presence database received an invalid definition.");
            }
            const stored = structuredClone(definition);
            await agentDatabaseRun(
                ctx.db,
                sql`INSERT INTO ${sql.raw(CATALOG_TABLE)} (id, definition_json)
                    VALUES (${stored.id}, ${JSON.stringify(stored)})
                    ON CONFLICT (id)
                    DO UPDATE SET definition_json = EXCLUDED.definition_json`,
            );
            return stored;
        },
        clear: async (ctx: Context, id: string): Promise<boolean> => {
            const rows = await agentDatabaseRows<{ id: string }>(
                ctx.db,
                sql`DELETE FROM ${sql.raw(CATALOG_TABLE)}
                    WHERE id = ${id}
                    RETURNING id`,
            );
            return rows.length > 0;
        },
    } as const;

    const schedules = {
        list: listSchedules,
        set: async (
            ctx: Context,
            input: PresenceScheduleInput,
            id: string,
        ): Promise<PresenceSchedule> => {
            const schedule = { id, ...structuredClone(input) };
            if (!Value.Check(presenceScheduleSchema, schedule)) {
                throw new Error("Presence database received an invalid schedule.");
            }
            await agentDatabaseRun(
                ctx.db,
                sql`INSERT INTO ${sql.raw(SCHEDULE_TABLE)} (id, schedule_json)
                    VALUES (${schedule.id}, ${JSON.stringify(schedule)})
                    ON CONFLICT (id)
                    DO UPDATE SET schedule_json = EXCLUDED.schedule_json`,
            );
            return schedule as PresenceSchedule;
        },
        clear: async (ctx: Context, id: string): Promise<boolean> => {
            const rows = await agentDatabaseRows<{ id: string }>(
                ctx.db,
                sql`DELETE FROM ${sql.raw(SCHEDULE_TABLE)}
                    WHERE id = ${id}
                    RETURNING id`,
            );
            return rows.length > 0;
        },
    } as const;

    const database: PresenceDatabase = {
        readConfigured,
        read: async (ctx, at) => {
            const configured = await readConfigured(ctx);
            if (configured !== undefined) {
                if (configured.effectiveFrom !== undefined && at < configured.effectiveFrom) {
                    return undefined;
                }
                if (configured.expiresAt !== undefined && at >= configured.expiresAt) {
                    return configured.fallbackPresenceId === undefined
                        ? undefined
                        : {
                              presenceId: configured.fallbackPresenceId,
                              effectiveFrom: configured.expiresAt,
                          };
                }
                return configured;
            }
            return await effectiveSchedule(ctx, at, listSchedules);
        },
        set: async (ctx, state) => {
            if (!Value.Check(presenceStoredStateSchema, state)) {
                throw new Error("Presence database received an invalid state.");
            }
            assertStoredTimeOrder(state);
            await agentDatabaseRun(
                ctx.db,
                sql`INSERT INTO ${sql.raw(PRESENCE_TABLE)} (singleton_id, state_json)
                    VALUES (1, ${JSON.stringify(state)})
                    ON CONFLICT (singleton_id)
                    DO UPDATE SET state_json = EXCLUDED.state_json`,
            );
        },
        clear: async (ctx) => {
            await agentDatabaseRun(
                ctx.db,
                sql`DELETE FROM ${sql.raw(PRESENCE_TABLE)} WHERE singleton_id = 1`,
            );
        },
        catalog,
        schedules,
    };
    if (!Value.Check(presenceDatabaseSchema, database)) {
        throw new Error("Presence database factory returned an invalid database.");
    }
    return database;
}

async function effectiveSchedule(
    ctx: Context,
    at: number,
    list: (
        ctx: Context,
        options: { readonly limit: number },
    ) => Promise<readonly PresenceSchedule[]>,
): Promise<PresenceStoredState | undefined> {
    const schedules = await list(ctx, { limit: 10_000 });
    const now = new Date(at);
    for (const schedule of schedules) {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: schedule.timeZone,
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(now);
        const weekday = parts.find((part) => part.type === "weekday")?.value;
        const hour = Number(parts.find((part) => part.type === "hour")?.value);
        const minute = Number(parts.find((part) => part.type === "minute")?.value);
        const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "");
        if (!schedule.days.includes(day)) continue;
        const current = hour * 60 + minute;
        const start = minutes(schedule.startTime);
        const end = minutes(schedule.endTime);
        const active =
            start <= end ? current >= start && current < end : current >= start || current < end;
        if (active) return referenceToStored(schedule.presence);
    }
    return undefined;
}

function referenceToStored(reference: PresenceSchedule["presence"]): PresenceStoredState {
    if ("presenceId" in reference) {
        return {
            presenceId: reference.presenceId,
            ...(reference.message === undefined ? {} : { message: reference.message }),
        };
    }
    return {
        presenceId: reference.status,
        ...(reference.message === undefined ? {} : { message: reference.message }),
    };
}

function assertStoredTimeOrder(state: PresenceStoredState): void {
    if (
        state.effectiveFrom !== undefined &&
        state.expiresAt !== undefined &&
        state.expiresAt <= state.effectiveFrom
    ) {
        throw new Error("Presence expiry must be after its effective time.");
    }
}

function minutes(value: string): number {
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function parseJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new Error(`Presence database ${label} is not valid JSON.`);
    }
}
