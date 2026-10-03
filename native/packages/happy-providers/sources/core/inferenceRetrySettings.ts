export const DEFAULT_INFERENCE_MAX_RETRIES = 10;
export const MAX_INFERENCE_MAX_RETRIES = 100;

export function resolveInferenceMaxRetries(value?: number): number {
    if (value === undefined) return DEFAULT_INFERENCE_MAX_RETRIES;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        throw new TypeError("inferenceMaxRetries must be a finite nonnegative integer.");
    }
    return Math.min(value, MAX_INFERENCE_MAX_RETRIES);
}

export interface InferenceRetryOptions {
    /** Maximum provider-owned retries. Ten retries permit up to eleven total attempts. */
    readonly inferenceMaxRetries?: number;
    /** Resolves the current limit so long-lived sessions follow runtime configuration changes. */
    resolveInferenceMaxRetries?: () => number;
    /** Test seam for provider-owned empty-response backoff. */
    waitForInferenceRetry?: (attempt: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Lets one session opt out of the provider's retry budget.
 *
 * A provider decides how its own conversation recovers, but a caller running a single bounded
 * request on the side is answering to something else — a tool call waiting on it, with a person
 * watching. Waiting out ten attempts there spends minutes to reach a failure the caller would
 * rather have had at once, so the session may name its own budget and the provider honors it.
 */
export function sessionInferenceMaxRetriesResolver(
    options: { inferenceMaxRetries?: number },
    providerResolver: () => number,
): () => number {
    if (options.inferenceMaxRetries === undefined) return providerResolver;
    const configured = resolveInferenceMaxRetries(options.inferenceMaxRetries);
    return () => configured;
}

export function createInferenceMaxRetriesResolver(options: InferenceRetryOptions): () => number {
    const configured =
        options.resolveInferenceMaxRetries ??
        (() => resolveInferenceMaxRetries(options.inferenceMaxRetries));
    const resolve = (): number => resolveInferenceMaxRetries(configured());
    resolve();
    return resolve;
}
