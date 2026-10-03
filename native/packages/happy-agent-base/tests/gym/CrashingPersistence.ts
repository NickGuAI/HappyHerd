import type { Context } from "@steve.kite/stdlib";

import type { AgentPersistence, AgentRecord } from "../../sources/index.js";
import type { InMemoryPersistence } from "./InMemoryPersistence.js";

/** Thrown by every operation of a crashed process, and recognizable to the test driver. */
export class ProcessCrashed extends Error {
    constructor() {
        super("The process died.");
        this.name = "ProcessCrashed";
    }
}

export function isCrash(error: unknown): boolean {
    return error instanceof ProcessCrashed;
}

/**
 * A store that fails some operations and keeps working. Unlike a crash, the process lives on, so
 * this exercises what the agent does with an error it could in principle recover from: a failed
 * write must leave nothing half-applied, and nothing the caller was told had been accepted may
 * disappear.
 */
export class FlakyPersistence implements AgentPersistence {
    readonly disk: InMemoryPersistence;

    operations = 0;
    failures = 0;

    readonly #fails: (operation: number) => boolean;

    constructor(disk: InMemoryPersistence, fails: (operation: number) => boolean) {
        this.disk = disk;
        this.#fails = fails;
    }

    get database() {
        return this.disk.database;
    }

    #step(): void {
        this.operations += 1;
        if (!this.#fails(this.operations)) return;
        this.failures += 1;
        throw new Error("The store is briefly unavailable.");
    }

    transaction<Result>(ctx: Context, work: (ctx: Context) => Promise<Result>): Promise<Result> {
        this.#step();
        return this.disk.transaction(ctx, work);
    }

    load(_ctx: Context): Promise<readonly AgentRecord[]> {
        this.#step();
        return this.disk.load();
    }

    append(ctx: Context, record: AgentRecord): Promise<void> {
        this.#step();
        return this.disk.append(ctx, record);
    }

    clearRecords(ctx: Context): Promise<void> {
        this.#step();
        return this.disk.clearRecords(ctx);
    }

    readValues(
        ctx: Context,
        prefix: string,
    ): Promise<readonly { readonly key: string; readonly value: unknown }[]> {
        this.#step();
        return this.disk.readValues(ctx, prefix);
    }

    writeValue(ctx: Context, key: string, value: unknown): Promise<void> {
        this.#step();
        return this.disk.writeValue(ctx, key, value);
    }

    writeValueIfAbsent(ctx: Context, key: string, value: unknown): Promise<boolean> {
        this.#step();
        return this.disk.writeValueIfAbsent(ctx, key, value);
    }

    deleteValue(ctx: Context, key: string): Promise<void> {
        this.#step();
        return this.disk.deleteValue(ctx, key);
    }
}

/**
 * One process's view of a store that outlives it. Operations pass straight through to the shared
 * disk until the configured operation number, where the process dies: that operation and every
 * later one throws, so a write in flight never lands, an open transaction rolls back, and the
 * dead process can no longer touch the disk at all. What the disk holds afterwards is exactly
 * what had already been committed — which is the whole point of crashing here.
 */
export class CrashingPersistence implements AgentPersistence {
    readonly disk: InMemoryPersistence;

    /** Operations survived so far, counted across the whole process. */
    operations = 0;
    crashed = false;

    /** The operation number that kills the process, or undefined for a process that survives. */
    readonly #crashAt: number | undefined;

    constructor(disk: InMemoryPersistence, crashAt?: number) {
        this.disk = disk;
        this.#crashAt = crashAt;
    }

    get database() {
        return this.disk.database;
    }

    /** Count this operation, dying instead if the process has reached its crash point. */
    #step(): void {
        if (this.crashed) throw new ProcessCrashed();
        this.operations += 1;
        if (this.#crashAt !== undefined && this.operations >= this.#crashAt) {
            this.crashed = true;
            throw new ProcessCrashed();
        }
    }

    transaction<Result>(ctx: Context, work: (ctx: Context) => Promise<Result>): Promise<Result> {
        this.#step();
        return this.disk.transaction(ctx, work);
    }

    load(_ctx: Context): Promise<readonly AgentRecord[]> {
        this.#step();
        return this.disk.load();
    }

    append(ctx: Context, record: AgentRecord): Promise<void> {
        this.#step();
        return this.disk.append(ctx, record);
    }

    clearRecords(ctx: Context): Promise<void> {
        this.#step();
        return this.disk.clearRecords(ctx);
    }

    readValues(
        ctx: Context,
        prefix: string,
    ): Promise<readonly { readonly key: string; readonly value: unknown }[]> {
        this.#step();
        return this.disk.readValues(ctx, prefix);
    }

    writeValue(ctx: Context, key: string, value: unknown): Promise<void> {
        this.#step();
        return this.disk.writeValue(ctx, key, value);
    }

    writeValueIfAbsent(ctx: Context, key: string, value: unknown): Promise<boolean> {
        this.#step();
        return this.disk.writeValueIfAbsent(ctx, key, value);
    }

    deleteValue(ctx: Context, key: string): Promise<void> {
        this.#step();
        return this.disk.deleteValue(ctx, key);
    }
}
