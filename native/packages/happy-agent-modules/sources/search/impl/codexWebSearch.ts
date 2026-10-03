import type { SearchAnswer, SearchProviderRequest, SearchSource } from "../Search.js";
import type { SessionTool } from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

import { runOneOffInference } from "./runOneOffInference.js";
import { selectSearchRoute } from "./SearchRoute.js";
import { sessionOutputText } from "./sessionOutputText.js";
import { boundedSources } from "./boundedSources.js";
import type { VendorSearchContext } from "./VendorSearchContext.js";

/** Codex's own web search, run and settled by OpenAI inside the response that asked for it. */
const codexNativeWebSearch = {
    name: "web_search",
    server: {
        type: "web_search",
        external_web_access: false,
        search_content_types: ["text", "image"],
    },
} as const satisfies SessionTool;

export async function codexWebSearch(
    ctx: Context,
    search: VendorSearchContext,
    request: SearchProviderRequest,
): Promise<SearchAnswer> {
    const route = selectSearchRoute(
        "Codex",
        search.routes.codex,
        search.routes.currentProviderId,
        request.providerId,
    );
    let searched = false;
    const payloads: string[] = [];
    const result = await runOneOffInference(ctx, {
        providers: search.providers,
        route,
        instructions:
            "Use the provider's web search before answering. Return a compact factual answer with markdown source links.",
        prompt: codexPrompt(request),
        tools: [codexNativeWebSearch],
        onEvent: (event) => {
            if (event.type === "toolcall_start" && event.server === true) searched = true;
            if (event.type === "toolcall_result_end")
                payloads.push(sessionOutputText(event.content));
        },
    });
    if (!searched) {
        throw new Error(`Codex answered "${request.query}" without searching the web.`);
    }
    if (result.text.length === 0) {
        throw new Error(`Codex searched for "${request.query}" but wrote no answer.`);
    }
    return {
        provider: "codex",
        query: request.query,
        answer: result.text,
        sources: boundedSources(codexCitations(result.text, payloads)),
        durationMs: result.durationMs,
    };
}

function codexPrompt(request: SearchProviderRequest): string {
    return [
        `Research this query: ${request.query}`,
        ...(request.allowedDomains === undefined || request.allowedDomains.length === 0
            ? []
            : [`Prioritize these domains: ${request.allowedDomains.join(", ")}.`]),
        "Use web search, explain the answer briefly, and include markdown links for every citation.",
    ].join("\n");
}

/**
 * Codex cites both in prose and in the payloads its own search returns, and the two disagree
 * often enough that taking only one of them loses sources the answer actually leaned on.
 */
function codexCitations(text: string, payloads: readonly string[]): SearchSource[] {
    const citations = new Map<string, SearchSource>();
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu)) {
        if (match[1] !== undefined && match[2] !== undefined) {
            citations.set(match[2], { title: match[1].trim(), url: match[2] });
        }
    }
    for (const payload of payloads) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch {
            continue;
        }
        const values = [parsed];
        while (values.length > 0) {
            const value = values.pop();
            if (Array.isArray(value)) {
                values.push(...value);
                continue;
            }
            if (typeof value !== "object" || value === null) continue;
            const record = value as Record<string, unknown>;
            const url =
                typeof record.url === "string"
                    ? record.url
                    : typeof record.href === "string"
                      ? record.href
                      : undefined;
            if (url !== undefined) {
                const title =
                    typeof record.title === "string"
                        ? record.title
                        : typeof record.label === "string"
                          ? record.label
                          : url;
                citations.set(url, { title, url });
            }
            values.push(...Object.values(record));
        }
    }
    return [...citations.values()];
}
