import { pathToFileURL } from "node:url";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { AgentDatabaseConnection } from "./AgentDatabaseConnection.js";
import { acquireAgentSQLiteProcessLock } from "./AgentSQLiteProcessLock.js";

export type AgentLibSQLDatabase = LibSQLDatabase;

/** Open one production SQLite database with Agent Base's shared ownership contract. */
export async function openAgentSQLiteDatabase(
    path: string,
): Promise<AgentDatabaseConnection<AgentLibSQLDatabase>> {
    const processLock = await acquireAgentSQLiteProcessLock(path);
    const client = createClient({
        intMode: "number",
        timeout: 5_000,
        url: pathToFileURL(path).href,
    });
    try {
        await configure(client);
        return new AgentDatabaseConnection(drizzle(client), async () => {
            try {
                client.close();
            } finally {
                await processLock.release();
            }
        });
    } catch (error) {
        try {
            client.close();
        } finally {
            await processLock.release();
        }
        throw error;
    }
}

async function configure(client: Client): Promise<void> {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = FULL");
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute("PRAGMA busy_timeout = 250");
    await awaitCrashRecovery(client);
    await client.execute("PRAGMA busy_timeout = 5000");
}

async function awaitCrashRecovery(client: Client): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            const transaction = await client.transaction("write");
            await transaction.rollback();
            return;
        } catch (error) {
            if (!isBusy(error) || attempt === 19) throw error;
            await new Promise<void>((resolve) => {
                setTimeout(resolve, Math.min(25 * (attempt + 1), 250));
            });
        }
    }
}

function isBusy(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "SQLITE_BUSY";
}
