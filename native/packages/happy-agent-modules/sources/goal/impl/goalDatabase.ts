import { sql } from "drizzle-orm";
import { agentDatabaseRows, agentDatabaseRun } from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

const GOAL_STATE_TABLE = "happy_agent_goal_state";

/**
 * The Goal module's database-backed per-agent key/value view.
 *
 * This is intentionally private to Goal. It has the tiny surface needed by the
 * state helpers, while the table and its migration remain owned by the module.
 * Each operation reads the active root or transaction facade from `ctx.db`.
 */
export class GoalDatabase {
    readonly #agentId: string;

    constructor(agentId: string) {
        this.#agentId = agentId;
    }

    async read(ctx: Context, key: string): Promise<unknown> {
        const rows = await agentDatabaseRows<{ value_json: string }>(
            ctx.db,
            sql`SELECT value_json
                FROM ${sql.raw(GOAL_STATE_TABLE)}
                WHERE agent_id = ${this.#agentId} AND state_key = ${key}
                LIMIT 1`,
        );
        const value = rows[0]?.value_json;
        return value === undefined ? undefined : JSON.parse(value);
    }

    async write(ctx: Context, key: string, value: unknown): Promise<void> {
        void ctx;
        const encoded = JSON.stringify(value);
        if (encoded === undefined) {
            throw new Error("Goal state cannot persist undefined.");
        }
        await agentDatabaseRun(
            ctx.db,
            sql`INSERT INTO ${sql.raw(GOAL_STATE_TABLE)}
                    (agent_id, state_key, value_json)
                VALUES (${this.#agentId}, ${key}, ${encoded})
                ON CONFLICT (agent_id, state_key)
                DO UPDATE SET value_json = EXCLUDED.value_json`,
        );
    }

    async delete(ctx: Context, key: string): Promise<void> {
        await agentDatabaseRun(
            ctx.db,
            sql`DELETE FROM ${sql.raw(GOAL_STATE_TABLE)}
                WHERE agent_id = ${this.#agentId} AND state_key = ${key}`,
        );
    }
}

export type GoalDatabaseFacade = GoalDatabase;
