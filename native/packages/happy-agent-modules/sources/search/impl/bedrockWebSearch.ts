import type { SearchAnswer, SearchProviderRequest, SearchSource } from "../Search.js";
import type { SessionTool } from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

import { boundedSources } from "./boundedSources.js";
import { runOneOffInference } from "./runOneOffInference.js";
import { selectSearchRoute } from "./SearchRoute.js";
import type { VendorSearchContext } from "./VendorSearchContext.js";

/**
 * Bedrock's own hosted search, served from the index and page cache Amazon runs inside AWS.
 *
 * `external_web_access` is left off deliberately. Bedrock defaults it to `true` to match the
 * OpenAI Responses API, but the managed `AmazonBedrockFullAccess` policy does not grant
 * `bedrock-websearch:ExternalWebAccess`, so the default answers `403 AccessDenied` on the
 * authorization check for most identities. Off is what works everywhere, and it is also the
 * setting that keeps the request inside the AWS boundary.
 */
const bedrockNativeWebSearch = {
    name: "web_search",
    server: { type: "web_search", external_web_access: false },
} as const satisfies SessionTool;

export async function bedrockWebSearch(
    ctx: Context,
    search: VendorSearchContext,
    request: SearchProviderRequest,
): Promise<SearchAnswer> {
    const route = selectSearchRoute(
        "Bedrock",
        search.routes.bedrock,
        search.routes.currentProviderId,
        request.providerId,
    );
    let searched = false;
    const result = await runOneOffInference(ctx, {
        providers: search.providers,
        route,
        instructions:
            "Search the web before answering. Return a compact factual answer and cite every source you used.",
        prompt: `Research this query and answer it: ${request.query}`,
        tools: [bedrockNativeWebSearch],
        onEvent: (event) => {
            if (event.type === "toolcall_start" && event.server === true) searched = true;
        },
    });
    if (!searched) {
        throw new Error(`Bedrock answered "${request.query}" without searching its web index.`);
    }
    if (result.text.length === 0) {
        throw new Error(`Bedrock searched for "${request.query}" but wrote no answer.`);
    }
    return {
        provider: "bedrock",
        query: request.query,
        answer: result.text,
        sources: boundedSources(bedrockCitations(result.text)),
        durationMs: result.durationMs,
    };
}

/** Bedrock settles its search inside the response, so its citations arrive only in the prose. */
function bedrockCitations(text: string): SearchSource[] {
    return [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu)].flatMap((match) =>
        match[1] === undefined || match[2] === undefined
            ? []
            : [{ title: match[1].trim(), url: match[2] }],
    );
}
