import { createId } from "@paralleldrive/cuid2";
import type { AgentProviders } from "@slopus/happy-agent-base";
import type { SessionEvent, SessionTool } from "@slopus/happy-providers";
import { withLifetime, type Context } from "@steve.kite/stdlib";

import type { SearchRoute } from "./SearchRoute.js";

/**
 * A search is a reasoning model running several rounds of queries before it writes an answer, so
 * a minute does not separate a slow search from a stuck one — it mostly cuts off work that was
 * about to succeed.
 */
const DEFAULT_ONE_OFF_INFERENCE_TIMEOUT_MS = 5 * 60 * 1000;

export interface OneOffInferenceResult {
    readonly durationMs: number;
    readonly text: string;
}

export interface OneOffInferenceOptions {
    readonly providers: AgentProviders;
    readonly route: SearchRoute;
    readonly instructions: string;
    readonly prompt: string;
    readonly tools?: readonly SessionTool[];
    readonly onEvent?: (event: SessionEvent) => void;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
}

/**
 * Runs one bounded provider request without an agent loop.
 *
 * The caller owns any vendor-specific event interpretation through `onEvent`. This opens the
 * provider session, streams one request, collects text, and destroys the session.
 *
 * The request is never retried. A tool call is a step inside somebody's turn, so a provider that
 * quietly works through its retry budget spends minutes of that turn to arrive at the same answer,
 * and an account that is signed out or spent will never answer differently anyway. Failing at once
 * hands the model a real error it can act on, and it can simply search again if the failure was a
 * passing one.
 */
export async function runOneOffInference(
    ctx: Context,
    options: OneOffInferenceOptions,
): Promise<OneOffInferenceResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ONE_OFF_INFERENCE_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("One-off inference timeout must be a positive number of milliseconds.");
    }
    const provider = await options.providers.resolve(options.route.providerId, options.route.model);
    if (provider === null) {
        throw new Error(`Provider "${options.route.providerId}" is not configured.`);
    }
    const session = await provider.session(`one-off:${createId()}`, {
        inferenceMaxRetries: 0,
        instructions: options.instructions,
        tools: options.tools ?? [],
    });
    const controller = new AbortController();
    const abortFromCaller = () =>
        controller.abort(
            options.signal?.reason instanceof Error
                ? options.signal.reason
                : new Error("The search was cancelled."),
        );
    if (options.signal?.aborted === true) {
        abortFromCaller();
    } else {
        options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timeout = setTimeout(
        () => controller.abort(new Error(`The search timed out after ${String(timeoutMs)} ms.`)),
        timeoutMs,
    );
    timeout.unref();
    const startedAt = performance.now();
    let text = "";
    try {
        const consume = async (): Promise<OneOffInferenceResult> => {
            for await (const event of session.run(withLifetime(ctx, controller.signal), {
                context: {
                    instructions: options.instructions,
                    messages: [{ role: "user", content: [{ type: "text", text: options.prompt }] }],
                },
                effort: options.route.effort,
                model: options.route.model,
            })) {
                options.onEvent?.(event);
                if (event.type === "text_delta") text += event.delta;
                if (event.type !== "done") continue;
                if (event.state === "cancelled") throw new Error("The search was cancelled.");
                if (event.state === "error") throw new Error(event.message);
                return { durationMs: performance.now() - startedAt, text: text.trim() };
            }
            throw new Error("The provider session ended without a final result.");
        };
        return await Promise.race([consume(), rejectWhenAborted(controller.signal)]);
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortFromCaller);
        await session.destroy();
    }
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        const rejectWithReason = () =>
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new Error("The search was cancelled."),
            );
        if (signal.aborted) {
            rejectWithReason();
            return;
        }
        signal.addEventListener("abort", rejectWithReason, { once: true });
    });
}
