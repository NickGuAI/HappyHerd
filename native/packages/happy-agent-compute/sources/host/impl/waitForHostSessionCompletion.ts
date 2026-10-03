/**
 * Waits for a session to finish, for a bounded time, without consuming its output.
 *
 * The waiter registers itself so the completion handler can wake it, and is also released by the
 * timeout or an abort. A finished process still answers a later read, so a wait that times out is
 * a background command the caller comes back to rather than an error.
 */
export function waitForHostSessionCompletion(
    waiters: Set<() => void>,
    waitMs: number,
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        const finish = () => {
            if (settled) return;
            settled = true;
            waiters.delete(finish);
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
        };
        waiters.add(finish);
        timer = setTimeout(finish, waitMs);
        signal?.addEventListener("abort", finish, { once: true });
        if (signal?.aborted) finish();
    });
}
