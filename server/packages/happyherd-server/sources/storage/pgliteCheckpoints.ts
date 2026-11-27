import type { PGlite } from "@electric-sql/pglite";
import { log } from "../utils/log";

const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

// PGlite uses single-user PostgreSQL: there is no background checkpointer to
// enforce checkpoint_timeout or max_wal_size. Recycle WAL while serving too.
export function startPGliteCheckpoints(pg: PGlite | null): () => Promise<void> {
    if (!pg) return async () => {};

    let stopped = false;
    let pending = Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
        timer = setTimeout(() => {
            pending = checkpoint();
        }, CHECKPOINT_INTERVAL_MS);
        // Shared DOM declarations type this as a number; the server uses Node timers.
        (timer as unknown as NodeJS.Timeout).unref();
    };

    const checkpoint = async () => {
        try {
            // The public API queues behind transactions; never run CHECKPOINT
            // through a transaction client or the raw wire protocol.
            await pg.exec("CHECKPOINT");
        } catch (error) {
            log({ module: "pglite", level: "error" }, `WAL checkpoint failed; retrying at the next interval: ${error}`);
        } finally {
            if (!stopped) schedule();
        }
    };

    schedule();
    return async () => {
        stopped = true;
        clearTimeout(timer);
        await pending;
    };
}
