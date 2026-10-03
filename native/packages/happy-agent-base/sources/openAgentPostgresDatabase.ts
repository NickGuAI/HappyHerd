import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Options, type PostgresType, type Sql } from "postgres";

import { AgentDatabaseConnection } from "./AgentDatabaseConnection.js";

export type AgentPostgresJsDatabase = PostgresJsDatabase & { readonly $client: Sql };

export interface OpenAgentPostgresDatabaseOptions {
    readonly url: string;
    readonly options?: Options<Record<string, PostgresType>>;
}

/** Open one network PostgreSQL pool with Agent Base's shared ownership contract. */
export async function openAgentPostgresDatabase(
    config: OpenAgentPostgresDatabaseOptions,
): Promise<AgentDatabaseConnection<AgentPostgresJsDatabase>> {
    const client = postgres(config.url, config.options);
    const database = drizzle(client);
    return new AgentDatabaseConnection(database, async () => await client.end());
}
