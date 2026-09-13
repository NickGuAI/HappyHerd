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

describe('ApiMachineClient credential management RPC', () => {
    it('registers machine-scoped account and login handlers with schema validation', async () => {
        const flow = {
            id: 'login-1',
            provider: 'claude' as const,
            name: 'work',
            state: 'waiting-user' as const,
            verificationUrl: 'https://claude.ai/oauth/authorize',
            requiresCodeEntry: true,
            expiresAt: Date.now() + 60_000,
        };
        const credentialAccounts = {
            listAccounts: vi.fn(async () => []),
            use: vi.fn(async () => []),
            rename: vi.fn(async () => []),
            remove: vi.fn(async () => []),
            startLogin: vi.fn(async () => flow),
            login: {
                status: vi.fn(() => flow),
                submitCode: vi.fn(async () => ({ ...flow, state: 'starting' as const })),
                cancel: vi.fn(async () => ({ ...flow, state: 'canceled' as const })),
            },
        };
        const client = new ApiMachineClient('token', machineClient());
        client.setRPCHandlers({
            spawnSession: vi.fn(),
            stopSession: vi.fn(),
            changeGrokPermissionMode: vi.fn(),
            requestShutdown: vi.fn(),
            credentialAccounts: credentialAccounts as any,
        });
        const handlers = (client as any).rpcHandlerManager.handlers;

        await expect(handlers.get('machine-1:happyherd-credential-accounts-list')({}))
            .resolves.toEqual({ accounts: [] });
        await expect(handlers.get('machine-1:happyherd-credential-auth-start')({
            provider: 'claude',
            name: 'work',
        })).resolves.toEqual(flow);
        await expect(handlers.get('machine-1:happyherd-credential-auth-submit')({
            id: 'login-1',
            code: 'valid-code',
        })).resolves.toMatchObject({ id: 'login-1', state: 'starting' });
        expect(credentialAccounts.login.submitCode).toHaveBeenCalledWith('login-1', 'valid-code');

        await expect(handlers.get('machine-1:happyherd-credential-auth-submit')({
            id: 'login-1',
            code: '',
        })).rejects.toThrow();
        expect(credentialAccounts.login.submitCode).toHaveBeenCalledTimes(1);
    });
});
