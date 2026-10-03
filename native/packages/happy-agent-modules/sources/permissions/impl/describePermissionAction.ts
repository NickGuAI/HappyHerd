import type { AnyAgentTool } from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

/**
 * What a reviewer is deciding on, in words.
 *
 * A tool that can ask for a review owes a description of the exact action and the boundary it
 * crosses, because a decision made about "the tool ran" is not a decision about anything. A
 * missing description is a tool-definition error, not an invitation to invent a less precise
 * action for the reviewer.
 */
export function describePermissionAction(
    tool: AnyAgentTool,
    args: unknown,
    ctx: Context,
): string | undefined {
    let described: string | undefined;
    try {
        described = tool.describeAutoPermissionAction?.(args, ctx);
    } catch {
        return undefined;
    }
    if (typeof described !== "string") return undefined;
    const normalized = described.trim();
    return normalized.length === 0 ? undefined : normalized;
}
