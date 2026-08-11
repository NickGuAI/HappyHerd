import type { ApprovalPolicy, SandboxMode } from './codexAppServerTypes';
import type { PermissionMode } from '@/api/types';

export function resolveCodexExecutionPolicy(
    permissionMode: PermissionMode,
    sandboxManagedByHappy: boolean,
): { approvalPolicy: ApprovalPolicy; sandbox: SandboxMode } {
    if (sandboxManagedByHappy) {
        return {
            // Happy owns the approval decision in this mode. Keep Codex's
            // request channel open so the host can approve policy-gated
            // commands; `never` rejects them before our handler can run.
            approvalPolicy: 'on-request',
            sandbox: 'danger-full-access',
        };
    }

    const approvalPolicy: ApprovalPolicy = (() => {
        switch (permissionMode) {
            // Codex native modes
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
    if (sandboxManagedByHappy) {
        return true;
    }

    // safe-yolo is deliberately absent: its turns run with approvalPolicy
    // 'never' inside the workspace sandbox, so any approval codex still
    // surfaces (a sandbox-escalation retry or an MCP elicitation) is exactly
    // what safe-yolo promises to ask the user about.
    return permissionMode === 'yolo' || permissionMode === 'bypassPermissions';
}
