import { sql } from "drizzle-orm";
import type { Context } from "@steve.kite/stdlib";

import {
    agentDatabaseRows,
    agentDatabaseRun,
    type AgentDatabase,
    type AgentDatabaseFacade,
} from "./AgentDatabase.js";
import { agentStorageTransaction, withAgentDatabase } from "./AgentContexts.js";
import type { AgentPersistence, AgentRecord } from "./AgentPersistence.js";
import { insideAgentStorageTransaction, inTx } from "./inTx.js";

/** The database shared by every persistence scope in one AgentStorage. */
export interface AgentPersistenceDrizzleOptions<Database extends AgentDatabase = AgentDatabase> {
    readonly database: Database;
}

/**
 * Drizzle-backed records and key-value entries for either the collection root or one agent.
 * Tables are shared by every instance; `ownerId` is empty for collection state and the cuid2
 * agent identity for a conversation.
 */
export class AgentPersistenceDrizzle<
    Database extends AgentDatabase = AgentDatabase,
> implements AgentPersistence {
    readonly #options: AgentPersistenceDrizzleOptions<Database>;
    readonly #ownerId: string;

    constructor(options: AgentPersistenceDrizzleOptions<Database>, ownerId: string) {
        this.#options = options;
        this.#ownerId = ownerId;
    }

    get database(): AgentDatabase {
        return this.#options.database;
    }

    async transaction<Result>(
        ctx: Context,
        work: (ctx: Context) => Promise<Result>,
    ): Promise<Result> {
        return await inTx(this.#bound(ctx), work);
    }

    async load(ctx: Context): Promise<readonly AgentRecord[]> {
        return await this.#operation(ctx, async (database) => {
            const rows = await agentDatabaseRows<{ record_json: string }>(
                database,
                sql`SELECT record_json
                    FROM happy_agent_records
                    WHERE owner_id = ${this.#ownerId}
                    ORDER BY position`,
            );
            return rows.map(({ record_json }) => JSON.parse(record_json) as AgentRecord);
        });
    }

    async append(ctx: Context, record: AgentRecord): Promise<void> {
        await this.#operation(ctx, async (database) => {
            await agentDatabaseRun(
                database,
                sql`INSERT INTO happy_agent_records (owner_id, position, record_json)
                    SELECT ${this.#ownerId}, COALESCE(MAX(position), -1) + 1, ${JSON.stringify(record)}
                    FROM happy_agent_records
                    WHERE owner_id = ${this.#ownerId}`,
            );
        });
    }

    async clearRecords(ctx: Context): Promise<void> {
        await this.#operation(ctx, async (database) => {
            await agentDatabaseRun(
                database,
                sql`DELETE FROM happy_agent_records WHERE owner_id = ${this.#ownerId}`,
            );
        });
    }

    async readValues(
        ctx: Context,
        prefix: string,
    ): Promise<readonly { readonly key: string; readonly value: unknown }[]> {
        return await this.#operation(ctx, async (database) => {
            const rows = await agentDatabaseRows<{ key: string; value_json: string }>(
                database,
                sql`SELECT key, value_json
                    FROM happy_agent_values
                    WHERE owner_id = ${this.#ownerId}
                      AND substr(key, 1, length(${prefix})) = ${prefix}
                    ORDER BY key`,
            );
            return rows.map(({ key, value_json }) => ({ key, value: JSON.parse(value_json) }));
        });
    }

    async writeValue(ctx: Context, key: string, value: unknown): Promise<void> {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw new Error("Agent storage cannot persist undefined.");
        await this.#operation(ctx, async (database) => {
            await agentDatabaseRun(
                database,
                sql`INSERT INTO happy_agent_values (owner_id, key, value_json)
                    VALUES (${this.#ownerId}, ${key}, ${encoded})
                    ON CONFLICT (owner_id, key)
                    DO UPDATE SET value_json = EXCLUDED.value_json`,
            );
        });
    }

    async writeValueIfAbsent(ctx: Context, key: string, value: unknown): Promise<boolean> {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw new Error("Agent storage cannot persist undefined.");
        return await this.#operation(ctx, async (database) => {
            const rows = await agentDatabaseRows<{ key: string }>(
                database,
                sql`INSERT INTO happy_agent_values (owner_id, key, value_json)
                    VALUES (${this.#ownerId}, ${key}, ${encoded})
                    ON CONFLICT (owner_id, key) DO NOTHING
                    RETURNING key`,
            );
            return rows.length > 0;
        });
    }

    async deleteValue(ctx: Context, key: string): Promise<void> {
        await this.#operation(ctx, async (database) => {
            await agentDatabaseRun(
                database,
                sql`DELETE FROM happy_agent_values
                    WHERE owner_id = ${this.#ownerId} AND key = ${key}`,
            );
        });
    }

    /**
     * Run one statement against the carried transaction, or straight against the root database
     * when the context carries none. Every operation here is a single statement, so it is atomic
     * on its own; opening a transaction around it would buy nothing and would make an operation
     * running beside someone else's open transaction contend for the writer even when it only
     * reads. Work that needs multi-statement atomicity asks for `transaction` explicitly.
     */
    async #operation<Result>(
        ctx: Context,
        work: (database: AgentDatabaseFacade<Database>) => Promise<Result>,
    ): Promise<Result> {
        const transaction = agentStorageTransaction(ctx);
        if (transaction !== undefined) {
            if (transaction.lifetime.aborted) {
                throw new Error("The agent storage transaction carried by this context has ended.");
            }
            if (transaction.root !== this.#options.database) {
                throw new Error("A transaction context cannot be used with another agent storage.");
            }
            return await work(transaction.database as AgentDatabaseFacade<Database>);
        }
        if (insideAgentStorageTransaction()) {
            throw new Error(
                "Work started inside an agent storage transaction must use that transaction's context.",
            );
        }
        return await work(this.#options.database as unknown as AgentDatabaseFacade<Database>);
    }

    #bound(ctx: Context): Context {
        const transaction = agentStorageTransaction(ctx);
        if (transaction === undefined) return withAgentDatabase(ctx, this.#options.database);
        if (transaction.lifetime.aborted) {
            throw new Error("The agent storage transaction carried by this context has ended.");
        }
        if (transaction.root !== this.#options.database) {
            throw new Error("A transaction context cannot be used with another agent storage.");
        }
        return ctx;
    }
}
