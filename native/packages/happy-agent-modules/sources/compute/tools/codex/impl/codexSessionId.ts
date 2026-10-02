/**
 * The session identifier a Codex tool was given, once it is known to name a session at all.
 *
 * Codex's surface types this field as a plain number, so a model can send 1.5 or -3 and satisfy
 * the schema. The machine numbers its sessions from one, and asking it about a session that could
 * never exist is a mistake worth saying plainly rather than turning into "no such session".
 */
export function codexSessionId(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("The shell session identifier must be a whole number above zero.");
    }
    return value;
}
