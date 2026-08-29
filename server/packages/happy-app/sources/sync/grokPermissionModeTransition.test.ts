import { describe, expect, it, vi } from 'vitest';

import { transitionGrokPermissionModeAndCommit } from './grokPermissionModeTransition';

vi.mock('./ops', () => ({
    machineTransitionGrokPermissionMode: vi.fn(),
}));

describe('Grok permission mode transition', () => {
    it('commits visible state only after the exact receipt resolves', async () => {
        let resolveReceipt!: (value: {
            type: 'success';
            sessionId: string;
            permissionMode: string;
        }) => void;
        const request = vi.fn(() => new Promise<{
            type: 'success';
            sessionId: string;
            permissionMode: string;
        }>((resolve) => {
            resolveReceipt = resolve;
        }));
        const commit = vi.fn();

        const pending = transitionGrokPermissionModeAndCommit(
            'machine-1',
            'session-1',
            'bypassPermissions',
            { request, commit },
        );
        expect(commit).not.toHaveBeenCalled();

        resolveReceipt({
            type: 'success',
            sessionId: 'session-1',
            permissionMode: 'bypassPermissions',
        });
        await expect(pending).resolves.toMatchObject({ type: 'success' });
        expect(commit).toHaveBeenCalledOnce();
        expect(commit).toHaveBeenCalledWith('bypassPermissions');
    });

    it('rejects mismatched and failed receipts without committing', async () => {
        const commit = vi.fn();
        await expect(transitionGrokPermissionModeAndCommit(
            'machine-1',
            'session-1',
            'dontAsk',
            {
                request: vi.fn(async () => ({
                    type: 'success' as const,
                    sessionId: 'another-session',
                    permissionMode: 'dontAsk',
                })),
                commit,
            },
        )).rejects.toThrow('mismatched receipt');
        await expect(transitionGrokPermissionModeAndCommit(
            'machine-1',
            'session-1',
            'dontAsk',
            {
                request: vi.fn(async () => {
                    throw new Error('daemon rejected the mode');
                }),
                commit,
            },
        )).rejects.toThrow('daemon rejected the mode');
        expect(commit).not.toHaveBeenCalled();
    });
});
