import type { SearchAnswer, SearchProviderRequest, SearchSource } from "../Search.js";
import type { SessionTool } from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

import { boundedSources } from "./boundedSources.js";
import { runOneOffInference } from "./runOneOffInference.js";
import { selectSearchRoute } from "./SearchRoute.js";
import { sessionOutputText } from "./sessionOutputText.js";
import type { VendorSearchContext } from "./VendorSearchContext.js";

/** Web search completed by Grok inside the response that requested it. */
const grokNativeWebSearch = {
    name: "web_search",
    server: { type: "web_search" },
} as const satisfies SessionTool;

export async function grokWebSearch(
    ctx: Context,
    search: VendorSearchContext,
    request: SearchProviderRequest,
): Promise<SearchAnswer> {
    const route = selectSearchRoute(
        "Grok",
        search.routes.grok,
        search.routes.currentProviderId,
        request.providerId,
    );
    let searchCalls = 0;
    const fragments: string[] = [];
    const result = await runOneOffInference(ctx, {
        providers: search.providers,
        route,
        instructions:
            "Use web_search to research published pages. Do not use X search. Return a concise answer with markdown links.",
        prompt: grokWebPrompt(request),
        tools: [grokNativeWebSearch],
        onEvent: (event) => {
            if (event.type === "toolcall_start" && event.server === true) searchCalls += 1;
            if (event.type === "toolcall_result_end") {
                fragments.push(sessionOutputText(event.content));
            }
        },
    });
    if (searchCalls === 0) {
        throw new Error(`Grok answered "${request.query}" without searching the web.`);
    }
    if (result.text.length === 0) {
        throw new Error(`Grok searched for "${request.query}" but wrote no answer.`);
    }
    return {
        provider: "grok",
        query: request.query,
        answer: result.text,
        sources: boundedSources(grokWebSources(result.text, fragments)),
        durationMs: result.durationMs,
    };
}

function grokWebPrompt(request: SearchProviderRequest): string {
    return [
        `Search published web pages for: ${request.query}`,
        ...(request.allowedDomains === undefined || request.allowedDomains.length === 0
            ? []
            : [`Focus on these domains: ${request.allowedDomains.join(", ")}.`]),
        "Summarize the findings and cite every source as a markdown link.",
    ].join("\n");
}

/** Grok's search results arrive as loose text, so links are read straight out of them. */
function grokWebSources(text: string, fragments: readonly string[]): SearchSource[] {
    const sources = new Map<string, SearchSource>();
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu)) {
        if (match[1] !== undefined && match[2] !== undefined) {
            sources.set(match[2], { title: match[1].trim(), url: match[2] });
        }
    }
    for (const fragment of fragments) {
        for (const match of fragment.matchAll(/https?:\/\/[^\s"\\]+/gu)) {
            sources.set(match[0], { title: match[0], url: match[0] });
        }
    }
    return [...sources.values()];
}
