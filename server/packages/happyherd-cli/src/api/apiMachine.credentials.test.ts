import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ApiMachineClient } from './apiMachine';
import { CredentialAccountManager } from '../credentialPool/manager';
import { readCredentialPoolState, upsertCredentialAccount } from '../credentialPool/store';

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
            happyLibDir: '/opt/happyherd',
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
            resetCooldown: vi.fn(async () => []),
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
        const target = { id: '11111111-1111-4111-8111-111111111111', provider: 'claude', name: 'work', expectedCredentialVersion: 1 };
        await expect(handlers.get('machine-1:happyherd-credential-accounts-reset-cooldown')(target))
            .resolves.toEqual({ accounts: [] });
        expect(credentialAccounts.resetCooldown).toHaveBeenCalledExactlyOnceWith(target);
        await expect(handlers.get('machine-1:happyherd-credential-accounts-reset-cooldown')({ ...target, expectedCredentialVersion: 0 }))
            .rejects.toThrow();
        expect(credentialAccounts.resetCooldown).toHaveBeenCalledTimes(1);
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
    it('persists a cooldown reset through the machine RPC and returns the owner summary', async () => {
        const root = await mkdtemp(join(tmpdir(), 'credential-reset-rpc-'));
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        const manager = new CredentialAccountManager({ paths });
        try {
            const account = await upsertCredentialAccount({
                provider: 'claude', name: 'sample', credential: { type: 'oauth-token', token: 'synthetic' },
                limitedUntil: Date.now() + 60_000,
            }, { paths, now: 1 });
            const before = await readCredentialPoolState(paths);
            const client = new ApiMachineClient('synthetic', machineClient());
            client.setRPCHandlers({
                spawnSession: vi.fn(), stopSession: vi.fn(), changeGrokPermissionMode: vi.fn(),
                requestShutdown: vi.fn(), credentialAccounts: manager,
            });
            const handlers = (client as any).rpcHandlerManager.handlers;
            const result = await handlers.get('machine-1:happyherd-credential-accounts-reset-cooldown')({
                id: account.id, provider: 'claude', name: 'sample', expectedCredentialVersion: account.credentialVersion,
            });
            expect(result.accounts[0]).toMatchObject({ id: account.id, limitedUntil: null, status: 'stored' });
            expect(await readCredentialPoolState(paths)).toEqual({ ...before, accounts: [{ ...before.accounts[0], limitedUntil: null }] });
            expect(await handlers.get('machine-1:happyherd-credential-accounts-list')({})).toEqual(result);
        } finally {
            await manager.dispose();
            await rm(root, { recursive: true, force: true });
        }
    });

});
