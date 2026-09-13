import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));

import {
    getManagedCredentialLogin,
    listManagedCredentialAccounts,
    startManagedCredentialLogin,
    useManagedCredentialAccount,
} from './credentialOps';

const account = {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'codex',
    name: 'work',
    status: 'stored',
    current: true,
    limitedUntil: null,
    createdAt: 1,
    updatedAt: 2,
    credentialVersion: 1,
};

describe('credential manager machine RPC', () => {
    beforeEach(() => machineRPC.mockReset());

    it('targets the exact machine and parses secret-free account summaries', async () => {
        machineRPC.mockResolvedValue({ accounts: [account] });
        await expect(listManagedCredentialAccounts('machine-1')).resolves.toEqual([account]);
        expect(machineRPC).toHaveBeenCalledWith(
            'machine-1',
            'happyherd-credential-accounts-list',
            {},
        );
    });

    it('preserves daemon errors instead of replacing them with schema errors', async () => {
        machineRPC.mockResolvedValue({ error: 'A login is already in progress for this account.' });
        await expect(startManagedCredentialLogin('machine-1', {
            provider: 'claude',
            name: 'work',
        })).rejects.toThrow('A login is already in progress for this account.');
    });

    it.each(['failed', 'expired'] as const)('returns a valid %s login flow with its domain error', async (state) => {
        const flow = {
            id: 'flow-1',
            provider: 'claude',
            name: 'work',
            state,
            requiresCodeEntry: false,
            error: state === 'failed' ? 'Provider denied the login.' : 'Login request expired.',
            expiresAt: Date.now() + 60_000,
        };
        machineRPC.mockResolvedValue(flow);

        await expect(getManagedCredentialLogin('machine-1', 'flow-1')).resolves.toEqual(flow);
        expect(machineRPC).toHaveBeenCalledWith(
            'machine-1',
            'happyherd-credential-auth-status',
            { id: 'flow-1' },
        );
    });

    it('returns authoritative state from a default mutation', async () => {
        machineRPC.mockResolvedValue({ accounts: [{ ...account, current: true }] });
        await expect(useManagedCredentialAccount('machine-2', {
            id: account.id,
            provider: 'codex',
            name: 'work',
            expectedCredentialVersion: account.credentialVersion,
        })).resolves.toHaveLength(1);
        expect(machineRPC).toHaveBeenCalledWith(
            'machine-2',
            'happyherd-credential-accounts-use',
            {
                id: account.id,
                provider: 'codex',
                name: 'work',
                expectedCredentialVersion: account.credentialVersion,
            },
        );
    });
});
