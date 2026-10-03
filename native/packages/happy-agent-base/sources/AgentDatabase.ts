import { is, type SQL } from "drizzle-orm";
import { PgDatabase } from "drizzle-orm/pg-core";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Context } from "@steve.kite/stdlib";

import { agentDatabaseConnection } from "./AgentDatabaseConnection.js";

/**
 * Any asynchronous Drizzle SQLite database or transaction. The erased schema and result types
 * deliberately preserve the complete Drizzle query-builder surface without choosing a driver.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentSQLiteDatabase = BaseSQLiteDatabase<"async", any, any, any>;

/**
 * Any Drizzle PostgreSQL database or transaction, including PGlite. The concrete module generic
 * retains the caller's exact database type when a module needs its own typed schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentPostgresDatabase = PgDatabase<any, any, any>;

/** A supported engine-agnostic Drizzle database or active transaction facade. */
export type AgentDatabase = AgentSQLiteDatabase | AgentPostgresDatabase;

/**
 * The schema-aware Drizzle surface shared by a concrete root database and its transaction.
 * Driver-only root members such as `batch` and `$client` are intentionally absent.
 */
export type AgentDatabaseFacade<Database extends AgentDatabase> =
    Database extends BaseSQLiteDatabase<
        infer ResultKind,
        infer RunResult,
        infer FullSchema,
        infer Schema
    >
        ? BaseSQLiteDatabase<ResultKind, RunResult, FullSchema, Schema>
        : Database extends PgDatabase<infer QueryResult, infer FullSchema, infer Schema>
          ? PgDatabase<QueryResult, FullSchema, Schema>
          : never;

/**
 * One ordered, durably tracked module migration. The context carries the active facade in
 * `ctx.db`; the same facade is also passed explicitly so the migration retains its exact
 * engine-specific type.
 */
export type AgentModuleMigration<Database extends AgentDatabase = AgentDatabase> = readonly [
    key: string,
    migrate: (ctx: Context, database: AgentDatabaseFacade<Database>) => void | Promise<void>,
];

/** Whether a supported facade belongs to Drizzle's SQLite family. */
export function isAgentSQLiteDatabase(database: AgentDatabase): database is AgentSQLiteDatabase {
    return is(database, BaseSQLiteDatabase);
}

/** Run a query that returns rows on either supported Drizzle engine. */
export async function agentDatabaseRows<Row>(
    database: AgentDatabase,
    query: SQL,
): Promise<readonly Row[]> {
    const work = async (): Promise<readonly Row[]> => {
        if (isAgentSQLiteDatabase(database)) {
            return await database.all<Row>(query);
        }
        const result = await database.execute(query);
        if (Array.isArray(result)) return result as Row[];
        const rows = Reflect.get(result as object, "rows");
        if (!Array.isArray(rows)) {
            throw new Error("The PostgreSQL Drizzle query did not return a row collection.");
        }
        return rows as Row[];
    };
    const connection = agentDatabaseConnection(database);
    return connection === undefined ? await work() : await connection.operation(database, work);
}

/** Run a statement that does not need its returned rows. */
export async function agentDatabaseRun(database: AgentDatabase, query: SQL): Promise<void> {
    const work = async (): Promise<void> => {
        if (isAgentSQLiteDatabase(database)) {
            await database.run(query);
            return;
        }
        await database.execute(query);
    };
    const connection = agentDatabaseConnection(database);
    if (connection === undefined) {
        await work();
        return;
    }
    await connection.operation(database, work);
}
