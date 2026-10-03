import type { SessionTool } from "@/core/SessionTool.js";

export const web_search = {
    name: "web_search",
    server: {
        type: "web_search",
        external_web_access: false,
        search_content_types: ["text", "image"],
    },
} as const satisfies SessionTool;
