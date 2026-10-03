import type { SearchAnswer, SearchProviderRequest, SearchSource } from "../Search.js";
import type { SessionTool } from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

import { boundedSources } from "./boundedSources.js";
import { runOneOffInference } from "./runOneOffInference.js";
import { selectSearchRoute } from "./SearchRoute.js";
import { sessionOutputText } from "./sessionOutputText.js";
import type { VendorSearchContext } from "./VendorSearchContext.js";

/** X search completed by Grok inside the response that requested it. */
const grokNativeXSearch = {
    name: "x_search",
    server: { type: "x_search" },
} as const satisfies SessionTool;

export async function grokXSearch(
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
    let searched = false;
    const results: string[] = [];
    const result = await runOneOffInference(ctx, {
        providers: search.providers,
        route,
        instructions:
            "Use x_search to inspect posts on X. Return a concise synthesis and link every post you rely on.",
        prompt: grokXPrompt(request),
        tools: [grokNativeXSearch],
        onEvent: (event) => {
            if (event.type === "toolcall_start" && event.server === true) searched = true;
            if (event.type === "toolcall_result_end") {
                results.push(sessionOutputText(event.content));
            }
        },
    });
    if (!searched) {
        throw new Error(`Grok answered "${request.query}" without searching X.`);
    }
    if (result.text.length === 0) {
        throw new Error(`Grok searched X for "${request.query}" but wrote no answer.`);
    }
    return {
        provider: "grok-x",
        query: request.query,
        answer: result.text,
        sources: boundedSources(grokXPosts(result.text, results)),
        durationMs: result.durationMs,
    };
}

function grokXPrompt(request: SearchProviderRequest): string {
    return [
        `Search X for posts about: ${request.query}`,
        request.latest === true ? "Prefer the latest posts." : "Prefer the most relevant posts.",
        "Summarize the discussion and include direct x.com links.",
    ].join("\n");
}

/** Only x.com links are kept: an X search that cites a blog post has wandered off its job. */
function grokXPosts(text: string, results: readonly string[]): SearchSource[] {
    const posts = new Map<string, SearchSource>();
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?x\.com\/[^\s)]+)\)/gu)) {
        if (match[1] !== undefined && match[2] !== undefined) {
            posts.set(match[2], { title: match[1].trim(), url: match[2] });
        }
    }
    for (const result of results) {
        for (const match of result.matchAll(/https?:\/\/(?:www\.)?x\.com\/[^\s"\\]+/gu)) {
            posts.set(match[0], { title: "X post", url: match[0] });
        }
    }
    return [...posts.values()];
}
