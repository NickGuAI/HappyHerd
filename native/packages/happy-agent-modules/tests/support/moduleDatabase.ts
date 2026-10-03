import { DatabaseSync } from "node:sqlite";

import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { createRootContext, type Context, type RootContext } from "@steve.kite/stdlib";
import type { AgentDatabase, AgentModuleMigration } from "@slopus/happy-agent-base";
import { withAgentDatabase } from "@slopus/happy-agent-base";

export interface ModuleDatabase {
    readonly database: SqliteRemoteDatabase;
    readonly context: Context;
    /**
     * The application root this test's work hangs off, carrying the database. A module that starts
     * work outliving the call that asked for it takes its own named lifetime from here.
     */
    readonly rootContext: RootContext;
    readonly ready: Promise<void>;
    readonly close: () => void;
}

export function moduleDatabase(
    migrations: readonly AgentModuleMigration[],
    name: string,
): ModuleDatabase & { readonly database: AgentDatabase } {
    const sqlite = new DatabaseSync(":memory:");
    const database = drizzle(async (query, params, method) => {
        const statement = sqlite.prepare(query);
        if (method === "run") {
            statement.run(...params);
            return { rows: [] };
        }
        if (method === "get") {
            const row = statement.get(...params);
            return { rows: row === undefined ? [] : [row] };
        }
        if (method === "values") {
            statement.setReturnArrays(true);
            return { rows: statement.all(...params) };
        }
        return { rows: statement.all(...params) };
    });
    // Deriving from the root keeps the root: the database travels with every lifetime taken from
    // it, exactly as the application's own root carries it.
    const rootContext = withAgentDatabase(createRootContext(), database) as RootContext;
    const context = rootContext.named(name);
    // Ordered, exactly as Agent Base applies them: a later migration may depend on an earlier one.
    const ready = (async () => {
        for (const [, migrate] of migrations) await migrate(context, database);
    })();
    return {
        database,
        context,
        rootContext,
        ready,
        close: () => sqlite.close(),
    } as ModuleDatabase & { readonly database: AgentDatabase };
}
