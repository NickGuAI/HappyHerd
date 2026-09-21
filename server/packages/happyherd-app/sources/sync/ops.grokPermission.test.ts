import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: { getState: vi.fn() } }));

describe('Grok permission mode machine RPC', () => {
    beforeEach(() => machineRPC.mockReset());

    it('targets the selected exact machine and validates its receipt', async () => {
        machineRPC.mockResolvedValue({
            type: 'success',
            sessionId: 'session-1',
            permissionMode: 'dontAsk',
        });
        const { machineTransitionGrokPermissionMode } = await import('./ops');

        await expect(machineTransitionGrokPermissionMode(
            'machine-1',
            'session-1',
            'dontAsk',
        )).resolves.toMatchObject({ type: 'success', permissionMode: 'dontAsk' });
        expect(machineRPC).toHaveBeenCalledWith(
            'machine-1',
            'grok-permission-mode-transition',
            { sessionId: 'session-1', permissionMode: 'dontAsk' },
        );
    });

    it('rejects a malformed daemon receipt', async () => {
        machineRPC.mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        const { machineTransitionGrokPermissionMode } = await import('./ops');
        await expect(machineTransitionGrokPermissionMode(
            'machine-1',
            'session-1',
            'dontAsk',
        )).rejects.toThrow();
    });
});
