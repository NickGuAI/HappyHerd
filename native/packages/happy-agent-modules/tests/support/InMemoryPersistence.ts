import type { AgentPersistence, AgentRecord } from "@slopus/happy-agent-base";
import { createContextNamespace, type Context } from "@steve.kite/stdlib";

interface StagedTransaction {
    readonly owner: InMemoryPersistence;
    cleared: boolean;
    readonly records: AgentRecord[];
    readonly writes: Map<string, unknown>;
    readonly deletes: Set<string>;
}

// How a transaction rides on the context is this implementation's own business; a caller only
// passes the derived context back into the operations.
const stagedNamespace = createContextNamespace<StagedTransaction | undefined>(
    "moduleTestPersistenceTransaction",
    undefined,
    // Not detachable, exactly like the storage transaction the real persistence carries.
    { detachable: false },
);

/** A real store serializes what it is given, so this one copies rather than aliasing values. */
function stored<Value>(value: Value): Value {
    return structuredClone(value);
}

/**
 * An in-memory agent store for the module tests: an append-only record list plus a sorted
 * key-value store, with transactions that stage their effects and apply them at commit.
 */
export class InMemoryPersistence implements AgentPersistence {
    readonly database = undefined as never;
    readonly records: AgentRecord[] = [];
    readonly values = new Map<string, unknown>();

    async transaction<Result>(
        ctx: Context,
        work: (ctx: Context) => Promise<Result>,
    ): Promise<Result> {
        const staged: StagedTransaction = {
            owner: this,
            cleared: false,
            records: [],
            writes: new Map(),
            deletes: new Set(),
        };
        const result = await work(stagedNamespace.set(ctx, staged));
        if (staged.cleared) this.records.length = 0;
        this.records.push(...staged.records);
        for (const [key, value] of staged.writes) this.values.set(key, value);
        for (const key of staged.deletes) this.values.delete(key);
        return result;
    }

    clearRecords(ctx: Context): Promise<void> {
        const staged = this.#staged(ctx);
        if (staged === undefined) {
            this.records.length = 0;
        } else {
            staged.cleared = true;
            staged.records.length = 0;
        }
        return Promise.resolve();
    }

    load(): Promise<readonly AgentRecord[]> {
        return Promise.resolve(this.records.map((record) => stored(record)));
    }

    append(ctx: Context, record: AgentRecord): Promise<void> {
        const staged = this.#staged(ctx);
        if (staged === undefined) {
            this.records.push(stored(record));
        } else {
            staged.records.push(stored(record));
        }
        return Promise.resolve();
    }

    readValues(
        ctx: Context,
        prefix: string,
    ): Promise<readonly { readonly key: string; readonly value: unknown }[]> {
        const staged = this.#staged(ctx);
        const merged = new Map(this.values);
        if (staged !== undefined) {
            for (const [key, value] of staged.writes) merged.set(key, value);
            for (const key of staged.deletes) merged.delete(key);
        }
        const entries = [...merged.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, value]) => ({ key, value: stored(value) }));
        return Promise.resolve(entries);
    }

    writeValue(ctx: Context, key: string, value: unknown): Promise<void> {
        const staged = this.#staged(ctx);
        if (staged === undefined) {
            this.values.set(key, stored(value));
        } else {
            staged.writes.set(key, stored(value));
            staged.deletes.delete(key);
        }
        return Promise.resolve();
    }

    async writeValueIfAbsent(ctx: Context, key: string, value: unknown): Promise<boolean> {
        if ((await this.readValues(ctx, key)).some((entry) => entry.key === key)) return false;
        await this.writeValue(ctx, key, value);
        return true;
    }

    deleteValue(ctx: Context, key: string): Promise<void> {
        const staged = this.#staged(ctx);
        if (staged === undefined) {
            this.values.delete(key);
        } else {
            staged.deletes.add(key);
            staged.writes.delete(key);
        }
        return Promise.resolve();
    }

    #staged(ctx: Context): StagedTransaction | undefined {
        const transaction = stagedNamespace.get(ctx);
        return transaction?.owner === this ? transaction : undefined;
    }
}
