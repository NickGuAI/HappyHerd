import type { SessionTool } from "@/core/SessionTool.js";

/** Web search completed by Grok inside the response that requested it. */
export const server_web_search = {
    name: "web_search",
    server: { type: "web_search" },
} as const satisfies SessionTool;
