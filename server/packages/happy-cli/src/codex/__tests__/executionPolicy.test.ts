import { describe, expect, it } from 'vitest';
import {
    resolveCodexApprovalDisposition,
    resolveCodexExecutionPolicy,
    shouldAutoApproveCodexApproval,
} from '../executionPolicy';

describe('resolveCodexExecutionPolicy', () => {
    it('maps codex default mode to untrusted + workspace-write without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('default', false);

        expect(policy).toEqual({
            approvalPolicy: 'untrusted',
            sandbox: 'workspace-write',
        });
    });

    it('maps read-only mode to never + read-only without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('read-only', false);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'read-only',
        });
    });

    it('maps safe-yolo mode to never + workspace-write without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('safe-yolo', false);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'workspace-write',
        });
    });

    it('maps yolo to requestable approvals that the host auto-accepts', () => {
        const policy = resolveCodexExecutionPolicy('yolo', false);

        expect(policy).toEqual({
            approvalPolicy: 'on-request',
            sandbox: 'danger-full-access',
        });
        expect(shouldAutoApproveCodexApproval('yolo', false)).toBe(true);
    });

    it('maps bypassPermissions to the same requestable full-access contract', () => {
        const policy = resolveCodexExecutionPolicy('bypassPermissions', false);

        expect(policy).toEqual({
            approvalPolicy: 'on-request',
            sandbox: 'danger-full-access',
        });
        expect(shouldAutoApproveCodexApproval('bypassPermissions', false)).toBe(true);
    });

    it('resolves every advertised mode when a late approval callback arrives', () => {
        expect(resolveCodexApprovalDisposition('default', false)).toBe('prompt');
        expect(resolveCodexApprovalDisposition('auto', false)).toBe('prompt');
        expect(resolveCodexApprovalDisposition('read-only', false)).toBe('denied');
        expect(resolveCodexApprovalDisposition('safe-yolo', false)).toBe('denied');
        expect(resolveCodexApprovalDisposition('yolo', false)).toBe('approved');
    });

    it('auto-approves only full-access compatibility modes without managed sandbox', () => {
        expect(shouldAutoApproveCodexApproval('default', false)).toBe(false);
        expect(shouldAutoApproveCodexApproval('read-only', false)).toBe(false);
        expect(shouldAutoApproveCodexApproval('safe-yolo', false)).toBe(false);
        expect(shouldAutoApproveCodexApproval('yolo', false)).toBe(true);
        expect(shouldAutoApproveCodexApproval('bypassPermissions', false)).toBe(true);
    });

    it.each([
        ['default', { approvalPolicy: 'untrusted', sandbox: 'workspace-write' }, 'prompt'],
        ['auto', { approvalPolicy: 'on-request', sandbox: 'workspace-write' }, 'prompt'],
        ['read-only', { approvalPolicy: 'never', sandbox: 'read-only' }, 'denied'],
        ['safe-yolo', { approvalPolicy: 'never', sandbox: 'workspace-write' }, 'denied'],
        ['yolo', { approvalPolicy: 'on-request', sandbox: 'danger-full-access' }, 'approved'],
    ] as const)('keeps %s semantics when Happy adds an outer sandbox', (permissionMode, policy, disposition) => {
        expect(resolveCodexExecutionPolicy(permissionMode, true)).toEqual(policy);
        expect(resolveCodexApprovalDisposition(permissionMode, true)).toBe(disposition);
    });
});
