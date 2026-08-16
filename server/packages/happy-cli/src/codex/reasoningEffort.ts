import type { ModelListEntry, ReasoningEffort } from './codexAppServerTypes';

export const DEFAULT_CODEX_REASONING_EFFORT: ReasoningEffort = 'max';

export function initialCodexReasoningEffort(
    effort: ReasoningEffort | undefined,
): ReasoningEffort {
    return effort ?? DEFAULT_CODEX_REASONING_EFFORT;
}

/**
 * `max` is a semantic HappyHerd default. Resolve it against the selected
 * model's provider-owned catalog before starting a turn so older models never
 * receive an unsupported literal token.
 */
export function resolveCodexReasoningEffort(
    effort: ReasoningEffort | undefined,
    model: string | undefined,
    models: ReadonlyArray<ModelListEntry>,
): ReasoningEffort {
    const requestedEffort = initialCodexReasoningEffort(effort);
    if (requestedEffort !== DEFAULT_CODEX_REASONING_EFFORT) return requestedEffort;
    const selected = model
        ? models.find((candidate) => candidate.model === model || candidate.id === model)
        : models.find((candidate) => candidate.isDefault);
    if (!selected) return requestedEffort;
    const supported = selected.supportedReasoningEfforts
        .map((candidate) => candidate.reasoningEffort)
        .filter(isReasoningEffort);
    return supported.includes(DEFAULT_CODEX_REASONING_EFFORT)
        ? DEFAULT_CODEX_REASONING_EFFORT
        : supported.at(-1) ?? requestedEffort;
}

/**
 * Remote effort overrides come from the machine-advertised picker. Validate
 * only the wire shape here; Codex validates compatibility with the selected
 * model when the turn starts.
 */
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && value.trim().length > 0;
}
