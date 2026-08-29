import { describe, expect, it, vi } from 'vitest';

import { ApiMachineClient } from './apiMachine';

function machineClient() {
    return {
        id: 'machine-1',
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy',
        metadata: {
            host: 'machine',
            platform: 'linux',
            happyCliVersion: 'test',
            homeDir: '/home/user',
            happyHomeDir: '/home/user/.happyherd',
            happyLibDir: '/opt/happy',
        },
    } as any;
}

describe('ApiMachineClient Grok permission transition RPC', () => {
    it('registers the machine-scoped transition and validates both sides', async () => {
        const changeGrokPermissionMode = vi.fn(async () => ({
            type: 'success' as const,
            sessionId: 'session-1',
            permissionMode: 'dontAsk',
        }));
        const client = new ApiMachineClient('token', machineClient());
        client.setRPCHandlers({
            spawnSession: vi.fn(),
            stopSession: vi.fn(),
            changeGrokPermissionMode,
            requestShutdown: vi.fn(),
        });
        const handler = (client as any).rpcHandlerManager.handlers
            .get('machine-1:grok-permission-mode-transition');

        await expect(handler({
            sessionId: 'session-1',
            permissionMode: 'dontAsk',
        })).resolves.toEqual({
            type: 'success',
            sessionId: 'session-1',
            permissionMode: 'dontAsk',
        });
        expect(changeGrokPermissionMode).toHaveBeenCalledWith({
            sessionId: 'session-1',
            permissionMode: 'dontAsk',
        });
        await expect(handler({
            sessionId: 'session-1',
            permissionMode: '',
        })).rejects.toThrow();
    });
});
