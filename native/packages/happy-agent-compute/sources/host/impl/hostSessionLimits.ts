export const MAX_ACTIVE_HOST_SESSIONS = 64;
export const MAX_RETAINED_HOST_SESSIONS = 64;

/** The default patience for a foreground command before it is backgrounded or ends. */
export const DEFAULT_HOST_COMMAND_TIMEOUT_MS = 120_000;

/** The default cap on how much of a command's output is retained. */
export const DEFAULT_HOST_MAX_OUTPUT_BYTES = 512_000;

/**
 * How long a command has to shut itself down before it is forced.
 *
 * A dev server flushing state or a build removing a lock file deserves a
 * moment; two seconds is long enough to be polite and short enough that
 * stopping still feels immediate.
 */
export const HOST_SESSION_STOP_GRACE_MS = 2_000;
