import { join } from "node:path";

import type { HistoryMessage } from "../../history/index.js";
import {
    MAX_OBSERVATION_FILE_BYTES,
    MAX_OBSERVATION_HISTORY_FILES,
    MAX_OBSERVATION_PENDING_BYTES,
} from "../ObservationSettings.js";
import { RotatingFileWriter } from "./RotatingFileWriter.js";

/**
 * An agent ID is about to become a file name, so it is checked as one rather than trusted as an
 * identifier. Agent IDs are cuid2s; anything that is not plainly one never reaches the filesystem.
 */
const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

/**
 * Every change to an agent's history, appended to a file the user can read.
 *
 * The durable history already lives in the agent's database, where the model reads it back through
 * a tool. This is the other audience: a person tailing a file to see what their agent actually
 * said and did, without a query, a client, or a running daemon. One file per agent, one JSON
 * object per record, in the order the records committed.
 */
export class HistoryDump {
    readonly #directory: string;
    /** Open files, in least-recently-used order, so a long-lived daemon holds a bounded set. */
    readonly #writers = new Map<string, RotatingFileWriter>();
    #closed = false;

    constructor(directory: string) {
        this.#directory = directory;
    }

    /**
     * Append one line per message.
     *
     * This runs after the history transaction has committed, so nothing here can undo the records
     * it is describing, and nothing here is allowed to try.
     */
    async record(agentId: string, messages: readonly HistoryMessage[]): Promise<void> {
        if (this.#closed || messages.length === 0) return;
        if (!SAFE_AGENT_ID.test(agentId)) {
            throw new Error("The history dump received an agent ID it cannot name a file after.");
        }
        const writer = await this.#writer(agentId);
        for (const message of messages) {
            const line = encodeRecord(agentId, message);
            if (line !== undefined) writer.write(line);
        }
    }

    /** Resolve once every queued line has reached its file. */
    async flush(): Promise<void> {
        await Promise.all([...this.#writers.values()].map(async (writer) => writer.flush()));
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        const writers = [...this.#writers.values()];
        this.#writers.clear();
        await Promise.all(writers.map(async (writer) => writer.close()));
    }

    async #writer(agentId: string): Promise<RotatingFileWriter> {
        const existing = this.#writers.get(agentId);
        if (existing !== undefined) {
            // Re-inserting is what makes this map least-recently-used rather than insertion-ordered.
            this.#writers.delete(agentId);
            this.#writers.set(agentId, existing);
            return existing;
        }
        const opened = await RotatingFileWriter.open({
            maxBytes: MAX_OBSERVATION_FILE_BYTES,
            maxPendingBytes: MAX_OBSERVATION_PENDING_BYTES,
            path: join(this.#directory, `${agentId}.jsonl`),
        });
        this.#writers.set(agentId, opened);
        while (this.#writers.size > MAX_OBSERVATION_HISTORY_FILES) {
            const [oldestId, oldest] = this.#writers.entries().next().value ?? [];
            if (oldestId === undefined || oldest === undefined) break;
            this.#writers.delete(oldestId);
            await oldest.close();
        }
        return opened;
    }
}

/**
 * One history record as a line, or nothing when it cannot be one.
 *
 * A message that will not serialize is a message the dump cannot describe. Writing a placeholder
 * would be a lie about what the agent said, so the line is simply not written.
 *
 * The file says which agent the record belongs to, so the owner is stamped over anything the
 * message itself carried: a forged `agentId` field does not get to claim a different agent.
 */
function encodeRecord(agentId: string, message: HistoryMessage): string | undefined {
    try {
        const record = { agentId, ...message };
        record.agentId = agentId;
        return JSON.stringify(record);
    } catch {
        return undefined;
    }
}
