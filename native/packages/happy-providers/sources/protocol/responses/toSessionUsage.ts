import type { ResponseUsage } from "openai/resources/responses/responses.js";

import type { SessionUsage } from "@/core/SessionUsage.js";

export function toSessionUsage(usage: ResponseUsage | undefined): SessionUsage {
    const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
    const cacheWriteTokens = usage?.input_tokens_details?.cache_write_tokens ?? 0;
    const input = usage?.input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    return {
        input,
        output,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        totalTokens: usage?.total_tokens ?? input + output,
    };
}
