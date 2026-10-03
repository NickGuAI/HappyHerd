export interface TimedSignal {
    readonly signal: AbortSignal;
    dispose(): void;
}

/** A signal that aborts with its parent, and on its own once the deadline passes. */
export function createTimedSignal(parent: AbortSignal | undefined, timeoutMs: number): TimedSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort(parent?.reason);
    if (parent?.aborted === true) {
        onAbort();
    } else {
        parent?.addEventListener("abort", onAbort, { once: true });
    }
    const timeout = setTimeout(
        () => controller.abort(new Error("The request timed out.")),
        timeoutMs,
    );
    timeout.unref();
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timeout);
            parent?.removeEventListener("abort", onAbort);
        },
    };
}
