import { createHash } from "node:crypto";

/**
 * The session id one spawn request always resolves to.
 *
 * The phone retries a request it has not heard back about, and it must not get
 * a second session for it, so the id is derived from the request rather than
 * invented. Two daemons on one computer derive different ids from the same
 * request, which is what keeps their sessions apart.
 *
 * The digest is written in hexadecimal because the result is an Agent Base cuid2:
 * lower-case alphanumeric, starting with a letter, and at most 32 characters.
 */
export function createHappySpawnSessionId(machineId: string, clientRequestId: string): string {
    return `h${createHash("sha256")
        .update(machineId)
        .update("\0")
        .update(clientRequestId)
        .digest("hex")
        .slice(0, 31)}`;
}
