import {
    agentDatabaseRows,
    agentDatabaseRun,
    type AgentModuleMigration,
} from "@slopus/happy-agent-base";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";
import { sql } from "drizzle-orm";

import {
    compactionPageQuerySchema,
    compactionPageSchema,
    compactionSchema,
    DEFAULT_COMPACTION_PAGE_SIZE,
    type Compaction,
    type CompactionPage,
    type CompactionPageQuery,
    type RunningCompaction,
} from "../Compaction.js";

interface CompactionRow {
    readonly agent_id: string;
    readonly awaiting_after: number | string;
    readonly base_compaction_id: string | null;
    readonly compaction_id: string;
    readonly record_json: string;
    readonly sequence: number | string;
    readonly started_at: number | string;
    readonly status: string;
}

interface ParsedCompactionRow {
    readonly awaitingAfter: boolean;
    readonly baseCompactionId?: string;
    readonly compaction: Compaction;
    readonly sequence: number;
}

const MAX_RUNNING_COMPACTIONS = 10_000;

export const compactionMigrations: readonly AgentModuleMigration[] = [
    [
        "001-durable-compactions",
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`CREATE TABLE IF NOT EXISTS happy_agent_compactions (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    compaction_id TEXT NOT NULL UNIQUE,
                    agent_id TEXT NOT NULL,
                    base_compaction_id TEXT UNIQUE,
                    status TEXT NOT NULL,
                    started_at INTEGER NOT NULL,
                    awaiting_after INTEGER NOT NULL DEFAULT 0,
                    record_json TEXT NOT NULL
                )`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE INDEX IF NOT EXISTS happy_agent_compactions_agent_sequence
                    ON happy_agent_compactions (agent_id, sequence DESC)`,
            );
            await agentDatabaseRun(
                database,
                sql`CREATE UNIQUE INDEX IF NOT EXISTS happy_agent_compactions_one_running
                    ON happy_agent_compactions (agent_id) WHERE status = 'running'`,
            );
        },
    ],
];

export class CompactionDatabase {
    async insert(
        ctx: Context,
        compaction: Compaction,
        options: { readonly baseCompactionId?: string; readonly awaitingAfter?: boolean } = {},
    ): Promise<void> {
        assertCompaction(compaction);
        await agentDatabaseRun(
            ctx.db,
            sql`INSERT INTO happy_agent_compactions (
                    compaction_id,
                    agent_id,
                    base_compaction_id,
                    status,
                    started_at,
                    awaiting_after,
                    record_json
                ) VALUES (
                    ${compaction.id},
                    ${compaction.agentId},
                    ${options.baseCompactionId ?? null},
                    ${compaction.status},
                    ${compaction.startedAt},
                    ${options.awaitingAfter === true ? 1 : 0},
                    ${JSON.stringify(compaction)}
                )`,
        );
    }

    async update(
        ctx: Context,
        compaction: Compaction,
        options: { readonly baseCompactionId?: string; readonly awaitingAfter?: boolean } = {},
    ): Promise<void> {
        assertCompaction(compaction);
        await agentDatabaseRun(
            ctx.db,
            sql`UPDATE happy_agent_compactions
                SET base_compaction_id = COALESCE(
                        ${options.baseCompactionId ?? null},
                        base_compaction_id
                    ),
                    status = ${compaction.status},
                    awaiting_after = ${options.awaitingAfter === true ? 1 : 0},
                    record_json = ${JSON.stringify(compaction)}
                WHERE compaction_id = ${compaction.id}`,
        );
    }

    async clearAwaitingAfter(ctx: Context, agentId: string): Promise<void> {
        await agentDatabaseRun(
            ctx.db,
            sql`UPDATE happy_agent_compactions
                SET awaiting_after = 0
                WHERE agent_id = ${agentId} AND awaiting_after = 1`,
        );
    }

    async get(ctx: Context, compactionId: string): Promise<Compaction | undefined> {
        return this.#one(
            await agentDatabaseRows<CompactionRow>(
                ctx.db,
                sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                           started_at, awaiting_after, record_json
                    FROM happy_agent_compactions
                    WHERE compaction_id = ${compactionId}
                    LIMIT 1`,
            ),
        )?.compaction;
    }

    async byBase(ctx: Context, baseCompactionId: string): Promise<Compaction | undefined> {
        return this.#one(
            await agentDatabaseRows<CompactionRow>(
                ctx.db,
                sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                           started_at, awaiting_after, record_json
                    FROM happy_agent_compactions
                    WHERE base_compaction_id = ${baseCompactionId}
                    LIMIT 1`,
            ),
        )?.compaction;
    }

    async running(ctx: Context, agentId: string): Promise<RunningCompaction | undefined> {
        const value = this.#one(
            await agentDatabaseRows<CompactionRow>(
                ctx.db,
                sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                           started_at, awaiting_after, record_json
                    FROM happy_agent_compactions
                    WHERE agent_id = ${agentId} AND status = 'running'
                    LIMIT 1`,
            ),
        )?.compaction;
        if (value === undefined) return undefined;
        if (value.status !== "running") {
            throw new Error("The compaction database returned a non-running active attempt.");
        }
        return value;
    }

    async runningAll(ctx: Context): Promise<readonly RunningCompaction[]> {
        const rows = await agentDatabaseRows<CompactionRow>(
            ctx.db,
            sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                       started_at, awaiting_after, record_json
                FROM happy_agent_compactions
                WHERE status = 'running'
                ORDER BY sequence
                LIMIT ${MAX_RUNNING_COMPACTIONS + 1}`,
        );
        if (rows.length > MAX_RUNNING_COMPACTIONS) {
            throw new Error("The running compaction recovery set exceeds its safe bound.");
        }
        return rows.map((row) => {
            const value = this.#parse(row).compaction;
            if (value.status !== "running") {
                throw new Error("The compaction database returned invalid running state.");
            }
            return value;
        });
    }

    async awaitingAfter(ctx: Context, agentId: string): Promise<Compaction | undefined> {
        return this.#one(
            await agentDatabaseRows<CompactionRow>(
                ctx.db,
                sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                           started_at, awaiting_after, record_json
                    FROM happy_agent_compactions
                    WHERE agent_id = ${agentId} AND awaiting_after = 1
                    ORDER BY sequence DESC
                    LIMIT 1`,
            ),
        )?.compaction;
    }

    async listPage(
        ctx: Context,
        agentId: string,
        query: CompactionPageQuery = {},
    ): Promise<CompactionPage> {
        if (!Value.Check(compactionPageQuerySchema, query)) {
            throw new Error("The compaction page query is invalid.");
        }
        const limit = query.limit ?? DEFAULT_COMPACTION_PAGE_SIZE;
        let beforeSequence: number | undefined;
        if (query.before !== undefined) {
            const before = this.#one(
                await agentDatabaseRows<CompactionRow>(
                    ctx.db,
                    sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                               started_at, awaiting_after, record_json
                        FROM happy_agent_compactions
                        WHERE agent_id = ${agentId} AND compaction_id = ${query.before}
                        LIMIT 1`,
                ),
            );
            if (before === undefined) return { compactions: [], hasMore: false };
            beforeSequence = before.sequence;
        }
        const rows = await agentDatabaseRows<CompactionRow>(
            ctx.db,
            beforeSequence === undefined
                ? sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                             started_at, awaiting_after, record_json
                      FROM happy_agent_compactions
                      WHERE agent_id = ${agentId}
                      ORDER BY sequence DESC
                      LIMIT ${limit + 1}`
                : sql`SELECT sequence, compaction_id, agent_id, base_compaction_id, status,
                             started_at, awaiting_after, record_json
                      FROM happy_agent_compactions
                      WHERE agent_id = ${agentId} AND sequence < ${beforeSequence}
                      ORDER BY sequence DESC
                      LIMIT ${limit + 1}`,
        );
        const page: CompactionPage = {
            compactions: rows.slice(0, limit).map((row) => this.#parse(row).compaction),
            hasMore: rows.length > limit,
        };
        if (!Value.Check(compactionPageSchema, page)) {
            throw new Error("The compaction database returned an invalid page.");
        }
        return structuredClone(page);
    }

    #one(rows: readonly CompactionRow[]): ParsedCompactionRow | undefined {
        const row = rows[0];
        return row === undefined ? undefined : this.#parse(row);
    }

    #parse(row: CompactionRow): ParsedCompactionRow {
        const sequence = Number(row.sequence);
        const startedAt = Number(row.started_at);
        const awaitingAfter = Number(row.awaiting_after);
        if (
            !Number.isSafeInteger(sequence) ||
            sequence < 1 ||
            !Number.isSafeInteger(startedAt) ||
            startedAt < 0 ||
            (awaitingAfter !== 0 && awaitingAfter !== 1)
        ) {
            throw new Error("The compaction database returned invalid indexed state.");
        }
        let value: unknown;
        try {
            value = JSON.parse(row.record_json) as unknown;
        } catch {
            throw new Error("The compaction database returned invalid JSON.");
        }
        if (!Value.Check(compactionSchema, value)) {
            throw new Error("The compaction database returned an invalid compaction.");
        }
        const compaction = value as Compaction;
        if (
            compaction.id !== row.compaction_id ||
            compaction.agentId !== row.agent_id ||
            compaction.status !== row.status ||
            compaction.startedAt !== startedAt
        ) {
            throw new Error("The compaction database indexes disagree with their resource.");
        }
        return {
            sequence,
            compaction: structuredClone(compaction),
            awaitingAfter: awaitingAfter === 1,
            ...(row.base_compaction_id === null
                ? {}
                : { baseCompactionId: row.base_compaction_id }),
        };
    }
}

function assertCompaction(value: unknown): asserts value is Compaction {
    if (!Value.Check(compactionSchema, value)) {
        throw new Error("The compaction mutation is invalid.");
    }
}
