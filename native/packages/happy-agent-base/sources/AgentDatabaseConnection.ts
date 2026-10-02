import { AsyncLocalStorage } from "node:async_hooks";

import type { AgentDatabase, AgentDatabaseFacade } from "./AgentDatabase.js";

type AgentDatabaseConnectionState = "open" | "closing" | "closed";

interface AgentDatabaseTransactionState {
    readonly connection: AgentDatabaseConnection;
    active: boolean;
}

interface AgentDatabaseRootOperationState {
    readonly connection: AgentDatabaseConnection;
    active: boolean;
}

const roots = new WeakMap<object, AgentDatabaseConnection>();
const transactions = new WeakMap<object, AgentDatabaseTransactionState>();
const activeTransaction = new AsyncLocalStorage<AgentDatabaseTransactionState>();
const activeRootOperation = new AsyncLocalStorage<AgentDatabaseRootOperationState>();

/**
 * One lifecycle owner for an Agent Base database.
 *
 * Root statements, root transactions, and close enter the same FIFO. Statements using the active
 * transaction facade execute directly because that transaction already owns the database slot.
 */
export class AgentDatabaseConnection<Database extends AgentDatabase = AgentDatabase> {
    readonly database: Database;
    readonly #closeDatabase: () => void | Promise<void>;
    #available: Promise<void> = Promise.resolve();
    #closePromise: Promise<void> | undefined;
    #state: AgentDatabaseConnectionState = "open";

    constructor(database: Database, closeDatabase: () => void | Promise<void>) {
        if (roots.has(database)) {
            throw new Error("The Agent Database already has a lifecycle owner.");
        }
        this.database = database;
        this.#closeDatabase = closeDatabase;
        roots.set(database, this);
    }

    /**
     * Run one database-owned step against the root FIFO, or directly when the current call chain
     * already owns this connection through a root step or transaction.
     */
    async operation<Result>(
        database: AgentDatabaseFacade<Database>,
        work: () => Promise<Result>,
    ): Promise<Result> {
        const transaction = transactions.get(database);
        if (transaction !== undefined) {
            if (!transaction.active) {
                throw new Error("The Agent Database transaction has ended.");
            }
            if (transaction.connection !== this) {
                throw new Error("The Agent Database transaction belongs to another connection.");
            }
            return await work();
        }
        if ((database as unknown) !== this.database) {
            throw new Error("The Agent Database operation uses an unknown facade.");
        }
        const ambient = activeTransaction.getStore();
        if (ambient?.active === true && ambient.connection === this) {
            throw new Error(
                "Work inside an Agent Database transaction must use its transaction facade.",
            );
        }
        const rootOperation = activeRootOperation.getStore();
        if (rootOperation?.active === true && rootOperation.connection === this) {
            return await work();
        }
        return await this.#admit(async () => {
            const state: AgentDatabaseRootOperationState = {
                connection: this,
                active: true,
            };
            try {
                return await activeRootOperation.run(state, work);
            } finally {
                state.active = false;
            }
        });
    }

    /**
     * Hold the root FIFO through commit and its in-process publication. A transaction opened
     * inside an existing database-owned step reuses that step instead of queuing behind itself.
     */
    async transaction<Result>(
        work: (database: AgentDatabaseFacade<Database>) => Promise<Result>,
        committed?: () => Promise<void>,
    ): Promise<Result> {
        const ambient = activeTransaction.getStore();
        if (ambient?.active === true && ambient.connection === this) {
            throw new Error("Nested Agent Database work must reuse the active transaction facade.");
        }
        const run = async (): Promise<Result> => {
            const result = await runRootTransaction(this.database, async (database) => {
                const state: AgentDatabaseTransactionState = {
                    connection: this,
                    active: true,
                };
                transactions.set(database, state);
                try {
                    return await activeTransaction.run(state, async () => {
                        return await work(database as AgentDatabaseFacade<Database>);
                    });
                } finally {
                    state.active = false;
                }
            });
            await committed?.();
            return result;
        };
        const rootOperation = activeRootOperation.getStore();
        if (rootOperation?.active === true && rootOperation.connection === this) {
            return await run();
        }
        return await this.#admit(async () => {
            const state: AgentDatabaseRootOperationState = {
                connection: this,
                active: true,
            };
            try {
                return await activeRootOperation.run(state, run);
            } finally {
                state.active = false;
            }
        });
    }

    /** Reject new work, drain admitted work, and close the owned driver exactly once. */
    async close(): Promise<void> {
        const transaction = activeTransaction.getStore();
        const rootOperation = activeRootOperation.getStore();
        if (
            (transaction?.active === true && transaction.connection === this) ||
            (rootOperation?.active === true && rootOperation.connection === this)
        ) {
            throw new Error("An Agent Database operation cannot close its own connection.");
        }
        if (this.#closePromise !== undefined) return await this.#closePromise;
        if (this.#state === "closed") return;
        this.#state = "closing";
        const closing = this.#enqueue(async () => {
            try {
                await this.#closeDatabase();
            } finally {
                this.#state = "closed";
            }
        });
        this.#closePromise = closing;
        await closing;
    }

    async #admit<Result>(work: () => Promise<Result>): Promise<Result> {
        if (this.#state !== "open") {
            throw new Error(`The Agent Database connection is ${this.#state}.`);
        }
        return await this.#enqueue(work);
    }

    async #enqueue<Result>(work: () => Promise<Result>): Promise<Result> {
        const previous = this.#available;
        let release!: () => void;
        this.#available = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    }
}

/** Find the owner of a root or transaction facade. */
export function agentDatabaseConnection(
    database: AgentDatabase,
): AgentDatabaseConnection | undefined {
    return roots.get(database) ?? transactions.get(database)?.connection;
}

/**
 * Give an externally opened database the standard Agent Base scheduling boundary.
 *
 * Production hosts should prefer one of the concrete openers, which also owns driver close.
 */
export function ensureAgentDatabaseConnection<Database extends AgentDatabase>(
    database: Database,
): AgentDatabaseConnection<Database> {
    const existing = roots.get(database);
    if (existing !== undefined) return existing as AgentDatabaseConnection<Database>;
    return new AgentDatabaseConnection(database, () => undefined);
}

/** Open a root transaction through its owner, or directly for an unowned test facade. */
export async function agentDatabaseTransaction<Result>(
    database: AgentDatabase,
    work: (database: AgentDatabase) => Promise<Result>,
    committed?: () => Promise<void>,
): Promise<Result> {
    const connection = agentDatabaseConnection(database);
    if (connection !== undefined && connection.database === database) {
        return await connection.transaction(async (transaction) => {
            return await work(transaction);
        }, committed);
    }
    const result = await runRootTransaction(database, work);
    await committed?.();
    return result;
}

/** Run one complete persistence step through the database owner's ordering boundary. */
export async function agentDatabaseOperation<Result>(
    database: AgentDatabase,
    work: () => Promise<Result>,
): Promise<Result> {
    const connection = agentDatabaseConnection(database);
    if (connection === undefined) return await work();
    return await connection.operation(database, work);
}

/** Start an independent lifetime without inheriting a caller's temporary database ownership. */
export function outsideAgentDatabaseOperation<Result>(work: () => Result): Result {
    return activeRootOperation.exit(work);
}

async function runRootTransaction<Result>(
    database: AgentDatabase,
    work: (database: AgentDatabase) => Promise<Result>,
): Promise<Result> {
    // Both supported Drizzle families expose the same callback transaction shape, but TypeScript
    // cannot invoke the union of their generic overloads without erasing that one internal call.
    const transaction = database.transaction.bind(database) as (
        work: (database: AgentDatabase) => Promise<Result>,
    ) => Promise<Result>;
    return await transaction(work);
}
