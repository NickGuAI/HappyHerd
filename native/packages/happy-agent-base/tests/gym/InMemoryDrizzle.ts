import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

/**
 * A package-local, throwaway libsql database on the same driver production uses, so tests see
 * production's transaction semantics: an open write transaction holds the single writer and a
 * concurrent transaction waits for it instead of failing fast. The database lives in a private
 * temporary file because the local libsql client opens one connection per transaction, and every
 * `:memory:` connection would be a separate empty database.
 */
export function inMemoryDrizzle(): {
    readonly database: LibSQLDatabase;
    readonly close: () => void;
} {
    const directory = mkdtempSync(join(tmpdir(), "happy-agent-base-test-"));
    const client = createClient({ url: `file:${join(directory, "agent.db")}` });
    const database = drizzle(client);
    return {
        database,
        close: () => {
            client.close();
            rmSync(directory, { force: true, recursive: true });
        },
    };
}
