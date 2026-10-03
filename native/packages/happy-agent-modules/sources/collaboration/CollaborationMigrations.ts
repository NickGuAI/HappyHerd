import { agentDatabaseRun, type AgentModuleMigration } from "@slopus/happy-agent-base";
import { sql } from "drizzle-orm";

/** A released key kept only so the applied history still lines up. It has nothing left to do. */
const retired = async (): Promise<void> => undefined;

/**
 * The schema this module used to have, and its removal.
 *
 * Collaboration stores nothing now, but a database that ran an earlier build still records the
 * migrations that build applied, and Agent Base requires the applied list to remain a prefix of
 * the declared one — an agent whose database remembers `001-collaboration` refuses to start if the
 * module no longer declares it. So the three released keys stay as retired markers, and one last
 * migration removes the tables they left behind.
 *
 * Nothing may be added here. A module with no state has no schema to change; this list only ever
 * shrinks, once no database can remember these keys.
 */
export const collaborationMigrations: readonly AgentModuleMigration[] = [
    ["001-collaboration", retired],
    ["002-drop-collaboration-receipts", retired],
    ["003-collaboration-run-state", retired],
    [
        "004-collaboration-storage-removed",
        async (_ctx, database) => {
            await agentDatabaseRun(
                database,
                sql`DROP TABLE IF EXISTS happy_collaboration_obligations`,
            );
            await agentDatabaseRun(
                database,
                sql`DROP TABLE IF EXISTS happy_collaboration_messages`,
            );
            await agentDatabaseRun(database, sql`DROP TABLE IF EXISTS happy_collaboration_agents`);
            await agentDatabaseRun(
                database,
                sql`DROP TABLE IF EXISTS happy_collaboration_receipts`,
            );
        },
    ],
];
