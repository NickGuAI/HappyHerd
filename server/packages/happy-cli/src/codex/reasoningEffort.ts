import type { ReasoningEffort } from './codexAppServerTypes';

/**
 * Remote effort overrides come from the machine-advertised picker. Validate
 * only the wire shape here; Codex validates compatibility with the selected
 * model when the turn starts.
 */
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && value.trim().length > 0;
}
