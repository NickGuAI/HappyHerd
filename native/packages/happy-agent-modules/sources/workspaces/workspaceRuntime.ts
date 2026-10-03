/** Small guarantees the workspace module relies on when it calls into anything it does not own. */

export function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return (
        typeof value === "object" &&
        value !== null &&
        "then" in value &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

export function requirePromise<T>(value: T | Promise<T>, label: string): Promise<T> {
    if (!isPromiseLike(value)) {
        throw new Error(`${label} must return a promise.`);
    }
    return value;
}

/** A bounded, readable message for something that failed after a durable decision was made. */
export function safeError(error: unknown): string {
    try {
        const message =
            error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : String(error);
        return message.slice(0, 512) || "Unknown workspace host error.";
    } catch {
        return "Unknown workspace host error.";
    }
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value !== null && typeof value === "object") {
        if (seen.has(value)) return value;
        seen.add(value);
        for (const child of Object.values(value as Record<string, unknown>)) {
            deepFreeze(child, seen);
        }
        Object.freeze(value);
    }
    return value;
}

export function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
    if (value === null || typeof value !== "object") return true;
    if (!Object.isFrozen(value)) return false;
    if (seen.has(value)) return true;
    seen.add(value);
    return Object.values(value as Record<string, unknown>).every((child) =>
        isDeepFrozen(child, seen),
    );
}
