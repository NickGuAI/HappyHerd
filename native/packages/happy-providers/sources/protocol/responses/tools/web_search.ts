import type { SessionTool } from "@/core/SessionTool.js";

/** Exact standard Responses web-search declaration. */
export const responses_web_search = {
    name: "web_search",
    server: { type: "web_search" },
} as const satisfies SessionTool;
