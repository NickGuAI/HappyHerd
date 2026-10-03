import type { ComputePermissionMode } from "../../ComputePermissions.js";

/**
 * A custom shell escapes the sandbox's own shell, so it is only offered where the sandbox is not
 * enforcing a boundary at all.
 */
export function assertCanUseCustomShell(
    mode: ComputePermissionMode,
    shell: string | undefined,
): void {
    if (shell !== undefined && mode !== "full_access") {
        throw new Error("Custom shells are available only in Full access mode.");
    }
}

/**
 * The host compute has no secret vault of its own, so it cannot inject secret bundles into a
 * command's environment. Rejecting the request keeps the boundary honest rather than silently
 * running the command without the secrets it asked for; wiring a secret provider is the agent
 * layer's responsibility.
 */
export function assertSecretsUnsupported(secrets: readonly string[] | undefined): void {
    if (secrets !== undefined && secrets.length > 0) {
        throw new Error(
            "The host compute cannot inject secret bundles; wire a secret provider at the agent layer.",
        );
    }
}
