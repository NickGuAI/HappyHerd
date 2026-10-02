import { sql } from "drizzle-orm";
import type { Context } from "@steve.kite/stdlib";

import {
    agentDatabaseRows,
    agentDatabaseRun,
    type AgentDatabase,
    type AgentDatabaseFacade,
    type AgentModuleMigration,
} from "./AgentDatabase.js";
import { ensureAgentDatabaseConnection } from "./AgentDatabaseConnection.js";
import type { AgentModule } from "./AgentModule.js";
import { AgentKV } from "./AgentKV.js";
import type { AgentPersistence } from "./AgentPersistence.js";
import type { AnyAgentTool } from "./AgentTool.js";
import { AgentPersistenceDrizzle } from "./AgentPersistenceDrizzle.js";

/**
 * The exclusive ownership of one durable agent store. A host sharing its database between
 * processes should back this with the same hard process-level lock as the database itself.
 */
export interface AgentStorageLock {
    /** Release the hard lock after the owning AgentSystem has stopped every agent. */
    release(ctx: Context): Promise<void>;
}

interface AgentStorageCommonOptions {
    /**
     * Acquire exclusive ownership of the whole store. This must fail while any other process or
     * AgentSystem owns the same durable store.
     */
    readonly acquireLock: (ctx: Context) => Promise<AgentStorageLock>;
}

/** Drizzle-owned storage. */
export type AgentStorageOptions<Database extends AgentDatabase = AgentDatabase> =
    AgentStorageCommonOptions & {
        /** The engine-specific Drizzle facade; the same object is passed through to modules. */
        readonly database: Database;
    };

/** Storage roots and Drizzle persistence shared by an `AgentSystemLocal` collection. */
export class AgentStorage<Database extends AgentDatabase = AgentDatabase> {
    /** The root Drizzle facade. */
    readonly database: Database;
    /** Shared key-value storage used for state spanning all agents. */
    readonly kv: AgentKV;
    /** Acquires the database-backed exclusive lock for this store. */
    readonly #acquireLock: (ctx: Context) => Promise<AgentStorageLock>;
    /** Produces the isolated persistence used by one agent. */
    readonly #persistence: (agentId: string) => AgentPersistence;
    /** Root persistence used for storage-wide transactions and key-value state. */
    readonly #drizzle: AgentPersistenceDrizzle<Database>;
    /** Prevents two systems from sharing even one AgentStorage instance. */
    #owned = false;

    constructor(options: AgentStorageOptions<Database>) {
        this.#acquireLock = options.acquireLock;
        this.database = options.database;
        ensureAgentDatabaseConnection(options.database);
        const integration = {
            database: options.database,
        };
        this.#drizzle = new AgentPersistenceDrizzle(integration, "");
        this.kv = new AgentKV(this.#drizzle, "agentSystem.");
        this.#persistence = (agentId) => new AgentPersistenceDrizzle(integration, agentId);
    }

    /**
     * Acquire exclusive ownership until the returned lock is released. The adapter's lock
     * enforces this across processes; the local guard also rejects accidental reuse of this
     * object.
     */
    async acquireLock(ctx: Context): Promise<AgentStorageLock> {
        if (this.#owned) throw new Error("The agent store is already owned by another system.");
        this.#owned = true;
        let lock: AgentStorageLock;
        try {
            lock = await this.#acquireLock(ctx);
        } catch (error: unknown) {
            this.#owned = false;
            throw error;
        }
        let released = false;
        return {
            release: async (releaseCtx) => {
                if (released) return;
                await lock.release(releaseCtx);
                released = true;
                this.#owned = false;
            },
        };
    }

    /** The isolated persistence for the given agent. */
    persistence(agentId: string): AgentPersistence {
        return this.#persistence(agentId);
    }

    /** Run work in this storage's internally managed transaction. */
    async transaction<Result>(
        ctx: Context,
        work: (ctx: Context, database: AgentDatabaseFacade<Database>) => Promise<Result>,
    ): Promise<Result> {
        return await this.#drizzle.transaction(
            ctx,
            async (txCtx) => await work(txCtx, txCtx.db as AgentDatabaseFacade<Database>),
        );
    }

    /**
     * Install the base schema and every module's ordered keyed migrations. Each migration and
     * its success marker commit atomically. Applied keys must remain an exact prefix, so inserting
     * or reordering historical migrations fails instead of silently changing their meaning.
     */
    async migrate(
        ctx: Context,
        modules: readonly AgentModule<AnyAgentTool, Database>[],
    ): Promise<void> {
        const names = modules.map((module) => module.name);
        if (names.includes("@happy-agent-base") || new Set(names).size !== names.length) {
            throw new Error("Module names must be unique and cannot use the agent-base owner.");
        }
        await this.#drizzle.transaction(ctx, async (txCtx) => {
            await agentDatabaseRun(
                txCtx.db,
                sql`CREATE TABLE IF NOT EXISTS happy_agent_migrations (
                    module_key TEXT NOT NULL,
                    migration_key TEXT NOT NULL,
                    position BIGINT NOT NULL,
                    PRIMARY KEY (module_key, migration_key),
                    UNIQUE (module_key, position)
                )`,
            );
        });
        await this.#migrateModule(ctx, "@happy-agent-base", [
            [
                "001-core-storage",
                async (_migrationCtx, database) => {
                    await agentDatabaseRun(
                        database,
                        sql`CREATE TABLE happy_agent_records (
                            owner_id TEXT NOT NULL,
                            position BIGINT NOT NULL,
                            record_json TEXT NOT NULL,
                            PRIMARY KEY (owner_id, position)
                        )`,
                    );
                    await agentDatabaseRun(
                        database,
                        sql`CREATE TABLE happy_agent_values (
                            owner_id TEXT NOT NULL,
                            key TEXT NOT NULL,
                            value_json TEXT NOT NULL,
                            PRIMARY KEY (owner_id, key)
                        )`,
                    );
                },
            ],
        ]);
        for (const module of modules) {
            await this.#migrateModule(ctx, module.name, module.migrations ?? []);
        }
    }

    async #migrateModule(
        ctx: Context,
        module: string,
        migrations: readonly AgentModuleMigration<Database>[],
    ): Promise<void> {
        const keys = migrations.map(([key]) => key);
        if (keys.some((key) => key.length === 0) || new Set(keys).size !== keys.length) {
            throw new Error(`Module "${module}" has an empty or duplicate migration key.`);
        }
        const applied = await this.#drizzle.transaction(ctx, async (txCtx) =>
            agentDatabaseRows<{
                migration_key: string;
                position: number | string;
            }>(
                txCtx.db,
                sql`SELECT migration_key, position
                    FROM happy_agent_migrations
                    WHERE module_key = ${module}
                    ORDER BY position`,
            ),
        );
        for (let index = 0; index < applied.length; index += 1) {
            if (
                applied[index]?.migration_key !== keys[index] ||
                Number(applied[index]?.position) !== index
            ) {
                throw new Error(
                    `The applied migrations for module "${module}" are not a prefix of its current migrations.`,
                );
            }
        }
        for (let index = applied.length; index < migrations.length; index += 1) {
            const migration = migrations[index];
            if (migration === undefined) continue;
            const [key, run] = migration;
            await this.#drizzle.transaction(ctx, async (txCtx) => {
                await run(txCtx, txCtx.db as AgentDatabaseFacade<Database>);
                await agentDatabaseRun(
                    txCtx.db,
                    sql`INSERT INTO happy_agent_migrations
                        (module_key, migration_key, position)
                        VALUES (${module}, ${key}, ${index})`,
                );
            });
        }
    }
}
