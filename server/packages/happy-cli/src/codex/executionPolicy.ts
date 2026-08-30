import type { ApprovalPolicy, SandboxMode } from './codexAppServerTypes';
import type { PermissionMode } from '@/api/types';

export function resolveCodexExecutionPolicy(
    permissionMode: PermissionMode,
    _sandboxManagedByHappy: boolean,
): { approvalPolicy: ApprovalPolicy; sandbox: SandboxMode } {
    const approvalPolicy: ApprovalPolicy = (() => {
        switch (permissionMode) {
            // Codex native modes
            case 'auto': return 'on-request';                      // Codex decides, asks only when it needs more
            case 'default': return 'untrusted';                    // Ask for non-trusted commands
            case 'read-only': return 'never';                      // Never ask, read-only enforced by sandbox
            case 'safe-yolo': return 'never';                      // Workspace sandbox enforces safety; do not prompt
            // Full-access modes still need Codex to emit approval requests for
            // commands its exec policy classifies as sensitive. The HappyHerd
            // approval bridge auto-accepts those requests without interrupting
            // the user; `never` would reject them before the bridge can act.
            case 'yolo': return 'on-request';
            // Defensive fallback for Claude-specific modes (backward compatibility)
            case 'bypassPermissions': return 'on-request';         // Full access: map to yolo behavior
            case 'acceptEdits': return 'on-request';               // Let model decide (closest to auto-approve edits)
            case 'plan': return 'untrusted';                       // Conservative: ask for non-trusted
            default: return 'untrusted';                           // Safe fallback
        }
    })();

    const sandbox: SandboxMode = (() => {
        switch (permissionMode) {
            // Codex native modes
            case 'auto': return 'workspace-write';                 // Codex's own Auto preset: on-request + workspace
            case 'default': return 'workspace-write';              // Can write in workspace
            case 'read-only': return 'read-only';                  // Read-only filesystem
            case 'safe-yolo': return 'workspace-write';            // Can write in workspace
            case 'yolo': return 'danger-full-access';              // Full system access
            // Defensive fallback for Claude-specific modes
            case 'bypassPermissions': return 'danger-full-access'; // Full access: map to yolo
            case 'acceptEdits': return 'workspace-write';          // Can edit files in workspace
            case 'plan': return 'workspace-write';                 // Can write for planning
            default: return 'workspace-write';                     // Safe default
        }
    })();

    return { approvalPolicy, sandbox };
}

export function shouldAutoApproveCodexApproval(
    permissionMode: PermissionMode,
    sandboxManagedByHappy: boolean,
): boolean {
    return resolveCodexApprovalDisposition(permissionMode, sandboxManagedByHappy) === 'approved';
}

/**
 * Resolve a late app-server approval callback against the permission policy
 * pinned to the active turn.
 *
 * `read-only` and `safe-yolo` both use Codex's native `never` policy. They are
 * no-prompt modes: if a callback still arrives because it was already in
 * flight, it must be denied without creating a pending user approval.
 */
export function resolveCodexApprovalDisposition(
    permissionMode: PermissionMode,
    _sandboxManagedByHappy: boolean,
): 'approved' | 'denied' | 'prompt' {
    switch (permissionMode) {
        case 'yolo':
        case 'bypassPermissions':
            return 'approved';
        case 'read-only':
        case 'safe-yolo':
            return 'denied';
        default:
            return 'prompt';
    }
}
