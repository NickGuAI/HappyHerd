import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createId } from "@paralleldrive/cuid2";
import postgres from "postgres";

import {
    openAgentPGliteDatabase,
    openAgentPostgresDatabase,
    openAgentSQLiteDatabase,
    type AgentDatabase,
    type AgentDatabaseConnection,
} from "../../sources/index.js";

/** One throwaway database on a real driver, torn down by `close` when the test is done. */
export interface TestDatabase {
    readonly connection: AgentDatabaseConnection;
    readonly database: AgentDatabase;
    readonly close: () => void | Promise<void>;
}

/**
 * The database engine selected for this test process. CI runs the entire Agent Base suite once
 * per supported value; local runs default to SQLite and can select another backend explicitly.
 */
export const databaseBackends: readonly {
    readonly label: string;
    readonly open: () => Promise<TestDatabase>;
}[] = [selectedBackend()];

function selectedBackend(): {
    readonly label: string;
    readonly open: () => Promise<TestDatabase>;
} {
    const selected = process.env.HAPPY_AGENT_BASE_TEST_DATABASE ?? "sqlite";
    if (selected === "sqlite") {
        return {
            label: "SQLite",
            open: async (): Promise<TestDatabase> => {
                const scratch = resolve(import.meta.dirname, "../../../.context");
                await mkdir(scratch, { recursive: true });
                const directory = await mkdtemp(join(scratch, "agent-base-sqlite-"));
                const connection = await openAgentSQLiteDatabase(join(directory, "agent.sqlite"));
                return {
                    connection,
                    database: connection.database,
                    close: async () => {
                        await connection.close();
                        await rm(directory, { force: true, recursive: true });
                    },
                };
            },
        };
    }
    if (selected === "pglite") {
        return {
            label: "PGlite",
            open: async (): Promise<TestDatabase> => {
                const connection = await openAgentPGliteDatabase();
                return {
                    connection,
                    database: connection.database,
                    close: async () => await connection.close(),
                };
            },
        };
    }
    if (selected === "postgres") return postgresBackend();
    throw new Error("HAPPY_AGENT_BASE_TEST_DATABASE must be sqlite, pglite, or postgres.");
}

function postgresBackend(): {
    readonly label: string;
    readonly open: () => Promise<TestDatabase>;
} {
    const url = process.env.HAPPY_AGENT_BASE_TEST_POSTGRES_URL;
    if (url === undefined) {
        throw new Error(
            "HAPPY_AGENT_BASE_TEST_POSTGRES_URL is required for the postgres test backend.",
        );
    }
    return {
        label: "PostgreSQL",
        open: async (): Promise<TestDatabase> => {
            const schema = `happy_agent_test_${createId().replaceAll("-", "_")}`;
            const admin = postgres(url, { max: 1 });
            await admin.unsafe(`CREATE SCHEMA ${schema}`);
            await admin.end();
            const connection = await openAgentPostgresDatabase({
                url,
                options: { connection: { search_path: schema } },
            });
            return {
                connection,
                database: connection.database,
                close: async () => {
                    await connection.close();
                    const cleanup = postgres(url, { max: 1 });
                    try {
                        await cleanup.unsafe(`DROP SCHEMA ${schema} CASCADE`);
                    } finally {
                        await cleanup.end();
                    }
                },
            };
        },
    };
}
