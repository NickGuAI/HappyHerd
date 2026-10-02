import { mkdir, open, rename, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

/** What one rotating file is allowed to cost, in bytes on disk and bytes held in memory. */
export interface RotatingFileWriterOptions {
    readonly path: string;
    /** How large the file may grow before the previous generation is replaced by it. */
    readonly maxBytes: number;
    /** How much text may wait to be written before further lines are dropped and counted. */
    readonly maxPendingBytes: number;
}

/**
 * An append-only text file that never grows without bound and never blocks its caller.
 *
 * Observation runs beside real work: a slow disk must not stall a turn, and a daemon that has been
 * up for a month must not have filled a partition. So `write` returns immediately and the actual
 * append happens on a serialized queue, the file is rolled over to one previous generation when it
 * reaches its size, and a queue that has fallen too far behind drops lines and says how many —
 * a truthful gap being better than unbounded memory.
 */
export class RotatingFileWriter {
    readonly #path: string;
    readonly #maxBytes: number;
    readonly #maxPendingBytes: number;

    #handle: FileHandle;
    #bytes: number;
    #pendingBytes = 0;
    #dropped = 0;
    #failed = 0;
    #closed = false;
    /** The tail of the serialized append queue. Every write chains onto it. */
    #queue: Promise<void> = Promise.resolve();

    private constructor(handle: FileHandle, bytes: number, options: RotatingFileWriterOptions) {
        this.#handle = handle;
        this.#bytes = bytes;
        this.#path = options.path;
        this.#maxBytes = options.maxBytes;
        this.#maxPendingBytes = options.maxPendingBytes;
    }

    static async open(options: RotatingFileWriterOptions): Promise<RotatingFileWriter> {
        if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
            throw new Error("A rotating file must be allowed at least one byte.");
        }
        if (!Number.isSafeInteger(options.maxPendingBytes) || options.maxPendingBytes < 1) {
            throw new Error("A rotating file must be allowed at least one pending byte.");
        }
        await mkdir(dirname(options.path), { recursive: true });
        const handle = await open(options.path, "a");
        const bytes = (await handle.stat()).size;
        return new RotatingFileWriter(handle, bytes, options);
    }

    /** Lines dropped because the queue was too far behind to hold them. */
    get droppedLines(): number {
        return this.#dropped;
    }

    /** Lines the filesystem refused. Observation reports its own gaps; it does not raise them. */
    get failedLines(): number {
        return this.#failed;
    }

    /** Queue one line. A line is written whole or not at all, and never partially. */
    write(line: string): void {
        if (this.#closed) {
            this.#dropped += 1;
            return;
        }
        const chunk = line.endsWith("\n") ? line : `${line}\n`;
        const size = Buffer.byteLength(chunk, "utf8");
        if (this.#pendingBytes + size > this.#maxPendingBytes) {
            this.#dropped += 1;
            return;
        }
        this.#pendingBytes += size;
        this.#queue = this.#queue.then(async () => {
            try {
                await this.#append(chunk, size);
            } catch {
                // A log that cannot be written must not become the failure it was recording.
                this.#failed += 1;
            } finally {
                this.#pendingBytes -= size;
            }
        });
    }

    /** Resolve once everything queued so far has reached the file. */
    async flush(): Promise<void> {
        await this.#queue;
    }

    /** Drain the queue and release the handle. Writes after this are dropped and counted. */
    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        await this.#queue;
        await this.#handle.close();
    }

    async #append(chunk: string, size: number): Promise<void> {
        // Roll over before the write rather than after it, so the limit is a ceiling on the file
        // rather than a threshold it is allowed to cross once per line.
        if (this.#bytes > 0 && this.#bytes + size > this.#maxBytes) {
            await this.#rotate();
        } else if (this.#bytes === 0 && size > this.#maxBytes) {
            // Rolling over is the only way a line ever makes room for itself, and an empty file has
            // nothing to roll aside. A line this large cannot be written whole without pushing the
            // file past its ceiling, so it is dropped and counted instead.
            this.#dropped += 1;
            return;
        }
        await this.#handle.write(chunk, null, "utf8");
        this.#bytes += size;
    }

    async #rotate(): Promise<void> {
        await this.#handle.close();
        // One previous generation is kept. Anything older was already too old to be worth the disk.
        await rename(this.#path, `${this.#path}.1`);
        this.#handle = await open(this.#path, "a");
        this.#bytes = await currentSize(this.#handle);
    }
}

async function currentSize(handle: FileHandle): Promise<number> {
    return (await handle.stat()).size;
}
