import type { SearchAnswer, SearchProviderRequest, SearchSource } from "../Search.js";
import type { SessionTool } from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

import { boundedSources } from "./boundedSources.js";
import { runOneOffInference } from "./runOneOffInference.js";
import { selectSearchRoute } from "./SearchRoute.js";
import { sessionOutputText } from "./sessionOutputText.js";
import type { VendorSearchContext } from "./VendorSearchContext.js";

/** Claude Code's own built-in web search, named so the vendor enables and runs it itself. */
const claudeNativeWebSearch = {
    name: "WebSearch",
    server: { type: "WebSearch" },
} as const satisfies SessionTool;

export async function claudeWebSearch(
    ctx: Context,
    search: VendorSearchContext,
    request: SearchProviderRequest,
): Promise<SearchAnswer> {
    const route = selectSearchRoute(
        "Claude",
        search.routes.claude,
        search.routes.currentProviderId,
        request.providerId,
    );
    let searched = false;
    const found = new Map<string, SearchSource>();
    const result = await runOneOffInference(ctx, {
        providers: search.providers,
        route,
        instructions:
            "Perform exactly one web research task. Use WebSearch before answering and cite every source.",
        prompt: claudePrompt(request),
        tools: [claudeNativeWebSearch],
        onEvent: (event) => {
            if (event.type === "toolcall_start" && event.server === true) searched = true;
            if (event.type === "toolcall_result_end") {
                collectClaudeResultSources(sessionOutputText(event.content), found);
            }
        },
    });
    if (!searched) {
        throw new Error(`Claude answered "${request.query}" without running WebSearch.`);
    }
    if (result.text.length === 0) {
        throw new Error(`Claude searched for "${request.query}" but wrote no answer.`);
    }
    for (const source of claudeMarkdownSources(result.text)) {
        found.set(source.url, source);
    }
    return {
        provider: "claude",
        query: request.query,
        answer: result.text,
        sources: boundedSources([...found.values()]),
        durationMs: result.durationMs,
    };
}

function claudePrompt(request: SearchProviderRequest): string {
    return [
        `Search the web for: ${request.query}`,
        ...(request.allowedDomains === undefined || request.allowedDomains.length === 0
            ? []
            : [`Only use these domains: ${request.allowedDomains.join(", ")}.`]),
        ...(request.blockedDomains === undefined || request.blockedDomains.length === 0
            ? []
            : [`Do not use these domains: ${request.blockedDomains.join(", ")}.`]),
        "Give a concise answer and finish with every source as a markdown link.",
    ].join("\n");
}

/** WebSearch returns its hits as JSON, whose shape Claude Code is free to change. */
function collectClaudeResultSources(result: string, sources: Map<string, SearchSource>): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(result);
    } catch {
        return;
    }
    const pending = [parsed];
    while (pending.length > 0) {
        const value = pending.pop();
        if (Array.isArray(value)) {
            pending.push(...value);
            continue;
        }
        if (typeof value !== "object" || value === null) continue;
        const record = value as Record<string, unknown>;
        if (typeof record.url === "string") {
            const title = typeof record.title === "string" ? record.title : record.url;
            sources.set(record.url, { title, url: record.url });
        }
        pending.push(...Object.values(record));
    }
}

function claudeMarkdownSources(text: string): SearchSource[] {
    return [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu)].flatMap((match) =>
        match[1] === undefined || match[2] === undefined
            ? []
            : [{ title: match[1].trim(), url: match[2] }],
    );
}
