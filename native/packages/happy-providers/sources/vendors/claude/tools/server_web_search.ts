import type { SessionTool } from "@/core/SessionTool.js";

/**
 * Web search run by Claude Code itself, inside the query that asked for it.
 *
 * Only the name is declared. It is the name of Claude Code's own built-in, which is what enables
 * that built-in and hands it the call; the description and schema belong to the built-in, so
 * restating them here could only ever disagree with what Claude actually runs.
 */
export const claude_server_web_search = {
    name: "WebSearch",
    server: { type: "WebSearch" },
} as const satisfies SessionTool;

export const claude_server_tools: readonly SessionTool[] = [claude_server_web_search];
