import type { SessionTool } from "@/core/SessionTool.js";

/** X search completed by Grok inside the response that requested it. */
export const server_x_search = {
    name: "x_search",
    server: { type: "x_search" },
} as const satisfies SessionTool;
