import { createHash } from "node:crypto";

const CODEX_CALL_ID_MAX_LENGTH = 64;

export function createCodexCallIdMapper(): (callId: string) => string {
    const remapped = new Map<string, string>();
    return (callId) => {
        if (callId.length <= CODEX_CALL_ID_MAX_LENGTH) return callId;
        const existing = remapped.get(callId);
        if (existing !== undefined) return existing;
        const hash = createHash("sha256").update(callId).digest("hex");
        const normalized = `call_${hash}`.slice(0, CODEX_CALL_ID_MAX_LENGTH);
        remapped.set(callId, normalized);
        return normalized;
    };
}
