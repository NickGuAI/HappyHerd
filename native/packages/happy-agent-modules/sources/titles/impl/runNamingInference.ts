import { createId } from "@paralleldrive/cuid2";
import type { AgentProviders } from "@slopus/happy-agent-base";
import { withLifetime, type Context } from "@steve.kite/stdlib";

import type { NamingRoute } from "./selectNamingRoute.js";

export interface NamingInferenceOptions {
    readonly providers: AgentProviders;
    readonly route: NamingRoute;
    readonly instructions: string;
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
}

/**
 * Runs one bounded provider request for a name, outside any agent loop.
 *
 * Naming a chat is its own one-shot conversation, not a turn of the chat's own: it opens a session
 * of its own, streams one request, takes the text, and destroys the session, so nothing it says
 * ever reaches the history the person reads or the context the agent works from.
 *
 * The provider request is never retried. Naming is optional background work, and an account that
 * is signed out or spent will not answer differently to an immediate replay.
 */
export async function runNamingInference(
    ctx: Context,
    options: NamingInferenceOptions,
): Promise<string> {
    const provider = await options.providers.resolve(options.route.providerId, options.route.model);
    if (provider === null) {
        throw new Error(`Provider "${options.route.providerId}" is not configured.`);
    }
    const session = await provider.session(`naming:${createId()}`, {
        inferenceMaxRetries: 0,
        instructions: options.instructions,
        tools: [],
    });
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("Naming was cancelled."));
    if (options.signal?.aborted === true) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(
        () =>
            controller.abort(new Error(`Naming timed out after ${String(options.timeoutMs)} ms.`)),
        options.timeoutMs,
    );
    timeout.unref();
    let text = "";
    try {
        for await (const event of session.run(withLifetime(ctx, controller.signal), {
            context: {
                instructions: options.instructions,
                messages: [{ role: "user", content: [{ type: "text", text: options.prompt }] }],
            },
            effort: options.route.effort,
            model: options.route.model,
        })) {
            if (event.type === "text_delta") text += event.delta;
            if (event.type !== "done") continue;
            if (event.state === "cancelled") throw new Error("Naming was cancelled.");
            if (event.state === "error") throw new Error(event.message);
            return text.trim();
        }
        throw new Error("The provider session ended without a name.");
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", cancel);
        await session.destroy();
    }
}
