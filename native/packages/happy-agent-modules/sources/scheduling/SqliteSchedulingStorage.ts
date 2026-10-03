import {
    agentDatabaseRows,
    agentDatabaseRun,
    type AgentDatabase,
    type AgentModuleMigration,
} from "@slopus/happy-agent-base";
import { sql } from "drizzle-orm";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import {
    schedulingSchedulePageQuerySchema,
    schedulingScheduledMessageSchema,
    schedulingWaitRecordSchema,
    type SchedulingSchedulePage,
    type SchedulingSchedulePageQuery,
    type SchedulingScheduledMessage,
    type SchedulingWaitRecord,
} from "./Scheduling.js";
import { schedulingPendingQuerySchema, type SchedulingStore } from "./SchedulingStore.js";

/** Tables owned by SchedulingModule. Keys are intentionally append-only module migrations. */
export const schedulingMigrations: readonly AgentModuleMigration[] = [
    [
        "001-scheduling",
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_scheduling_waits (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    record_json TEXT NOT NULL
                )`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE INDEX IF NOT EXISTS happy_scheduling_waits_agent
                    ON happy_scheduling_waits(agent_id, id)`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_scheduling_schedules (
                    id TEXT PRIMARY KEY,
                    sender_agent_id TEXT NOT NULL,
                    target_agent_id TEXT NOT NULL,
                    due_at BIGINT NOT NULL,
                    status TEXT NOT NULL,
                    schedule_json TEXT NOT NULL
                )`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE INDEX IF NOT EXISTS happy_scheduling_schedules_sender
                    ON happy_scheduling_schedules(sender_agent_id, due_at, id)`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE INDEX IF NOT EXISTS happy_scheduling_schedules_target
                    ON happy_scheduling_schedules(target_agent_id, due_at, id)`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_scheduling_receipts (
                    acting_agent_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    operation_id TEXT NOT NULL,
                    receipt_json TEXT NOT NULL,
                    PRIMARY KEY (acting_agent_id, kind, operation_id)
                )`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_scheduling_proofs (
                    acting_agent_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    operation_id TEXT NOT NULL,
                    proof_json TEXT NOT NULL,
                    PRIMARY KEY (acting_agent_id, kind, operation_id)
                )`,
            );
        },
    ],
    [
        "002-remove-scheduling-idempotency",
        async (_ctx, database) => {
            await agentDatabaseRun(database, sql`DROP TABLE IF EXISTS happy_scheduling_receipts`);
            await agentDatabaseRun(database, sql`DROP TABLE IF EXISTS happy_scheduling_proofs`);
        },
    ],
    [
        "003-remove-scheduling-operation-state",
        async (_ctx, database) => {
            await agentDatabaseRun(database, sql`DROP TABLE IF EXISTS happy_scheduling_receipts`);
            await agentDatabaseRun(database, sql`DROP TABLE IF EXISTS happy_scheduling_proofs`);
        },
    ],
    [
        // Recovery reads the pending messages of every agent in due order, which the per-sender and
        // per-target indexes cannot serve.
        "004-scheduling-due-index",
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`CREATE INDEX IF NOT EXISTS happy_scheduling_schedules_due
                    ON happy_scheduling_schedules(status, due_at, id)`,
            );
        },
    ],
];

export function createSqliteSchedulingStorage<
    Database extends AgentDatabase = AgentDatabase,
>(): SchedulingStore {
    const dbFor = (ctx: Context): Database => ctx.db as Database;
    const readWait = async (
        ctx: Context,
        agentId: string,
        id: string,
    ): Promise<SchedulingWaitRecord | undefined> => {
        const rows = await agentDatabaseRows<WaitRow>(
            dbFor(ctx),
            sql`SELECT record_json FROM happy_scheduling_waits
                WHERE id = ${id} AND agent_id = ${agentId} LIMIT 1`,
        );
        if (rows[0] === undefined) return undefined;
        const wait = parse(rows[0].record_json, "wait");
        if (!Value.Check(schedulingWaitRecordSchema, wait)) {
            throw new Error("Scheduling database returned an invalid durable wait.");
        }
        return wait as SchedulingWaitRecord;
    };
    const writeWait = async (ctx: Context, wait: SchedulingWaitRecord): Promise<void> => {
        await agentDatabaseRun(
            dbFor(ctx),
            sql`INSERT INTO happy_scheduling_waits (id, agent_id, record_json)
                VALUES (${wait.id}, ${wait.agentId}, ${JSON.stringify(wait)})
                ON CONFLICT(id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    record_json = excluded.record_json`,
        );
    };
    const readSchedule = async (
        ctx: Context,
        id: string,
    ): Promise<SchedulingScheduledMessage | undefined> => {
        const rows = await agentDatabaseRows<ScheduleRow>(
            dbFor(ctx),
            sql`SELECT schedule_json FROM happy_scheduling_schedules WHERE id = ${id} LIMIT 1`,
        );
        return rows[0] === undefined ? undefined : scheduleOf(rows[0]);
    };
    const writeSchedule = async (
        ctx: Context,
        schedule: SchedulingScheduledMessage,
    ): Promise<void> => {
        await agentDatabaseRun(
            dbFor(ctx),
            sql`INSERT INTO happy_scheduling_schedules
                (id, sender_agent_id, target_agent_id, due_at, status, schedule_json)
                VALUES (
                    ${schedule.id}, ${schedule.senderAgentId}, ${schedule.targetAgentId},
                    ${schedule.dueAt}, ${schedule.status}, ${JSON.stringify(schedule)}
                )
                ON CONFLICT(id) DO UPDATE SET
                    sender_agent_id = excluded.sender_agent_id,
                    target_agent_id = excluded.target_agent_id,
                    due_at = excluded.due_at,
                    status = excluded.status,
                    schedule_json = excluded.schedule_json`,
        );
    };
    const listSchedules = async (
        ctx: Context,
        query: SchedulingSchedulePageQuery,
    ): Promise<SchedulingSchedulePage> => {
        if (!Value.Check(schedulingSchedulePageQuerySchema, query)) {
            throw new Error("Scheduling schedule page query is invalid.");
        }
        const limit = query.limit ?? 50;
        const offset = cursorOffset(query.cursor);
        const status = query.status === undefined ? sql`` : sql` AND status = ${query.status}`;
        const sender =
            query.senderAgentId === undefined
                ? sql``
                : sql` AND sender_agent_id = ${query.senderAgentId}`;
        const target =
            query.targetAgentId === undefined
                ? sql``
                : sql` AND target_agent_id = ${query.targetAgentId}`;
        const rows = await agentDatabaseRows<ScheduleRow>(
            dbFor(ctx),
            sql`SELECT schedule_json FROM happy_scheduling_schedules
                WHERE 1 = 1${status}${sender}${target}
                ORDER BY due_at, id
                LIMIT ${limit + 1} OFFSET ${offset}`,
        );
        const schedules = rows.slice(0, limit).map(scheduleOf);
        return {
            schedules,
            limit,
            ...(offset > 0 ? { previousCursor: String(Math.max(0, offset - limit)) } : {}),
            ...(rows.length > limit ? { nextCursor: String(offset + schedules.length) } : {}),
        };
    };
    const listPendingSchedules = async (
        ctx: Context,
        query: { readonly limit: number; readonly afterDueAt?: number },
    ): Promise<SchedulingScheduledMessage[]> => {
        if (!Value.Check(schedulingPendingQuerySchema, query)) {
            throw new Error("Scheduling pending query is invalid.");
        }
        const after =
            query.afterDueAt === undefined ? sql`` : sql` AND due_at > ${query.afterDueAt}`;
        const rows = await agentDatabaseRows<ScheduleRow>(
            dbFor(ctx),
            sql`SELECT schedule_json FROM happy_scheduling_schedules
                WHERE status = 'pending'${after}
                ORDER BY due_at, id
                LIMIT ${query.limit}`,
        );
        return rows.map(scheduleOf);
    };
    return {
        readWait,
        writeWait,
        readSchedule,
        writeSchedule,
        listSchedules,
        listPendingSchedules,
    };
}

interface WaitRow {
    readonly record_json: string;
}

interface ScheduleRow {
    readonly schedule_json: string;
}

function scheduleOf(row: ScheduleRow): SchedulingScheduledMessage {
    const schedule = parse(row.schedule_json, "scheduled message");
    if (!Value.Check(schedulingScheduledMessageSchema, schedule)) {
        throw new Error("Scheduling database returned an invalid scheduled message.");
    }
    return schedule as SchedulingScheduledMessage;
}

function parse(value: unknown, label: string): unknown {
    if (typeof value !== "string") throw new Error(`Scheduling ${label} is not JSON text.`);
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new Error(`Scheduling ${label} contains invalid JSON.`);
    }
}

function cursorOffset(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    if (!/^(0|[1-9][0-9]*)$/.test(cursor)) throw new Error("Scheduling cursor is invalid.");
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset)) throw new Error("Scheduling cursor is too large.");
    return offset;
}
