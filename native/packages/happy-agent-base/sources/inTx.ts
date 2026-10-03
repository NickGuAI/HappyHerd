import { AsyncLocalStorage } from "node:async_hooks";

import { registerContextExtension, withAfterCommit, type Context } from "@steve.kite/stdlib";

import {
    agentDatabase,
    agentStorageTransaction,
    withAgentStorageTransaction,
    type AgentStorageTransactionContext,
} from "./AgentContexts.js";
import { agentDatabaseTransaction } from "./AgentDatabaseConnection.js";

/** Work whose database operations should share one outer Agent Storage transaction. */
export type AgentTransactionWork<Result> = (ctx: Context) => Result | PromiseLike<Result>;

interface AgentTransactionContextState {
    readonly activeTransactions: AsyncLocalStorage<AgentStorageTransactionContext>;
}

declare global {
    namespace stdlib {
        interface ContextExtensions {
            readonly inTx: <Result>(work: AgentTransactionWork<Result>) => Promise<Awaited<Result>>;
        }
    }
}

// Keep the extension and ambient transaction identity stable when a development loader or Vitest
// evaluates this module again in the same process.
const transactionContextRegistryKey = Symbol.for(
    "@slopus/happy-agent-base/transaction-context-registry/v1",
);
const existingTransactionContextRegistry = Reflect.get(
    globalThis,
    transactionContextRegistryKey,
) as WeakMap<object, AgentTransactionContextState> | undefined;
const transactionContextRegistry = existingTransactionContextRegistry ?? new WeakMap();
if (existingTransactionContextRegistry === undefined) {
    Reflect.set(globalThis, transactionContextRegistryKey, transactionContextRegistry);
}

const stdlibRegistryIdentity = registerContextExtension as object;
let transactionContextState = transactionContextRegistry.get(stdlibRegistryIdentity);
if (transactionContextState === undefined) {
    transactionContextState = {
        activeTransactions: new AsyncLocalStorage<AgentStorageTransactionContext>(),
    };
    registerContextExtension(
        "inTx",
        (ctx) =>
            async <Result>(work: AgentTransactionWork<Result>): Promise<Awaited<Result>> =>
                await inTx(ctx, work),
    );
    transactionContextRegistry.set(stdlibRegistryIdentity, transactionContextState);
}
const { activeTransactions } = transactionContextState;

/**
 * Whether the current asynchronous flow is inside an open agent storage transaction. Storage
 * operations use this to refuse a root context that would silently write around the transaction
 * enclosing it.
 */
export function insideAgentStorageTransaction(): boolean {
    const ambient = activeTransactions.getStore();
    return ambient !== undefined && !ambient.lifetime.aborted;
}

/**
 * Run work inside the database transaction carried by `ctx`, or open the one outer transaction
 * for its root database. Nested calls reuse the current transaction. Independent transaction
 * scheduling belongs to the database driver.
 */
export async function inTx<Result>(
    ctx: Context,
    work: AgentTransactionWork<Result>,
): Promise<Awaited<Result>> {
    const carried = agentStorageTransaction(ctx);
    const ambient = activeTransactions.getStore();
    if (ambient !== undefined && !ambient.lifetime.aborted) {
        if (carried === ambient) return await work(ctx);
        throw new Error(
            "Work started inside an agent storage transaction must use that transaction's context.",
        );
    }
    if (carried !== undefined) {
        if (carried.lifetime.aborted) {
            throw new Error("The agent storage transaction carried by this context has ended.");
        }
        return await work(ctx);
    }

    const root = agentDatabase(ctx);
    if (root === undefined) {
        throw new Error("Context has no agent database.");
    }

    let runAfterCommit!: () => Promise<void>;
    const result = await agentDatabaseTransaction(
        root,
        async (database) => {
            const [afterCommitCtx, drain] = withAfterCommit(ctx);
            runAfterCommit = drain;
            const lifetime = new AbortController();
            const state: AgentStorageTransactionContext = {
                database,
                root,
                lifetime: lifetime.signal,
            };
            const txCtx = withAgentStorageTransaction(afterCommitCtx, state);
            try {
                return await activeTransactions.run(state, async () => await work(txCtx));
            } finally {
                lifetime.abort();
            }
        },
        async () => {
            try {
                await runAfterCommit();
            } catch (error: unknown) {
                ctx.log.warn("Agent storage committed, but post-commit work failed.", error);
            }
        },
    );
    return result;
}
