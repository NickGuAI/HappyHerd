import { agentPermissionMode } from "@slopus/happy-agent-base";
import { computePermissions } from "@slopus/happy-agent-compute";
import type { Context } from "@steve.kite/stdlib";

import type { ComputePermissions } from "../Compute.js";

/**
 * Translate Agent Base's durable per-agent mode into the immutable boundary required by every
 * published compute operation.
 *
 * The compute backend remains the authority for host policy, symlink checks, and native sandbox
 * enforcement. This helper only carries the mode selected for the current tool invocation.
 */
export function computePermissionsForContext(ctx: Context): ComputePermissions {
    return computePermissions(agentPermissionMode(ctx));
}
