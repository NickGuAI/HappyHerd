import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import { AgentDatabaseConnection } from "./AgentDatabaseConnection.js";

export type AgentPGliteDatabase = PgliteDatabase;
export type OpenAgentPGliteDatabaseOptions = PGliteOptions & {
    readonly dataDir?: string;
};

/** Open one embedded PostgreSQL database with Agent Base's shared ownership contract. */
export async function openAgentPGliteDatabase(
    options: OpenAgentPGliteDatabaseOptions = {},
): Promise<AgentDatabaseConnection<AgentPGliteDatabase>> {
    const { dataDir, ...pgliteOptions } = options;
    const client = new PGlite(dataDir, pgliteOptions);
    try {
        await client.waitReady;
        return new AgentDatabaseConnection(drizzle(client), async () => await client.close());
    } catch (error) {
        await client.close();
        throw error;
    }
}
