import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";

import {
    mcpServerConfigEntrySchema,
    type McpServerConfigEntry,
    type McpServerConfigSource,
} from "./Mcp.js";

/**
 * The digest is a property of the durable configured-server record.  It is intentionally
 * independent of a live SDK client or transport, so changing the process connection cache cannot
 * silently change a user's saved trust decision.
 */
export function fingerprintMcpServer(entry: McpServerConfigEntry, workspaceCwd?: string): string {
    if (!Value.Check(mcpServerConfigEntrySchema, entry)) {
        throw new Error("MCP server configuration entry is invalid.");
    }
    const source = entry.source as McpServerConfigSource;
    return createHash("sha256")
        .update(
            stableJson({
                config: entry.config,
                name: entry.name,
                ...(source === "project" ? { workspaceCwd } : {}),
                source,
            }),
        )
        .digest("hex");
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
