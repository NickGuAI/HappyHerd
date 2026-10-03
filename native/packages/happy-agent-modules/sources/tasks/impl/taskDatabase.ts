import { sql } from "drizzle-orm";
import { agentDatabaseRows, agentDatabaseRun } from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

const TASK_STATE_TABLE = "happy_agent_task_state";

/** Private database view for one agent's bounded task collection. */
export class TaskDatabase {
    readonly #agentId: string;

    constructor(agentId: string) {
        this.#agentId = agentId;
    }

    async read(ctx: Context): Promise<unknown> {
        const rows = await agentDatabaseRows<{ tasks_json: string }>(
            ctx.db,
            sql`SELECT tasks_json
                FROM ${sql.raw(TASK_STATE_TABLE)}
                WHERE agent_id = ${this.#agentId}
                LIMIT 1`,
        );
        const value = rows[0]?.tasks_json;
        return value === undefined ? undefined : JSON.parse(value);
    }

    async write(ctx: Context, tasks: unknown): Promise<void> {
        const encoded = JSON.stringify(tasks);
        if (encoded === undefined) throw new Error("Task state cannot persist undefined.");
        await agentDatabaseRun(
            ctx.db,
            sql`INSERT INTO ${sql.raw(TASK_STATE_TABLE)} (agent_id, tasks_json)
                VALUES (${this.#agentId}, ${encoded})
                ON CONFLICT (agent_id)
                DO UPDATE SET tasks_json = EXCLUDED.tasks_json`,
        );
    }

    async delete(ctx: Context): Promise<void> {
        await agentDatabaseRun(
            ctx.db,
            sql`DELETE FROM ${sql.raw(TASK_STATE_TABLE)}
                WHERE agent_id = ${this.#agentId}`,
        );
    }
}
