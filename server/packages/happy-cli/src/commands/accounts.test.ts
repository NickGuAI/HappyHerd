import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCredentialAccounts: vi.fn(),
  removeCredentialAccount: vi.fn(),
  useCredentialAccount: vi.fn(),
  assertMutationAllowed: vi.fn(),
}));

vi.mock('@/credentialPool/store', () => mocks);
vi.mock('@/daemon/controlClient', () => ({
  assertDaemonCredentialAccountMutationAllowed: mocks.assertMutationAllowed,
}));

import { handleAccountsCommand } from './accounts';

describe('accounts command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists account state without exposing stored credential material', async () => {
    mocks.listCredentialAccounts.mockResolvedValue({
      state: { schemaVersion: 2, current: { claude: 'work' }, accounts: [] },
      accounts: [{
        id: '11111111-1111-4111-8111-111111111111',
        provider: 'claude',
        name: 'work',
        credential: { type: 'oauth-token', token: 'secret-token' },
        createdAt: 1,
        updatedAt: 1,
        limitedUntil: null,
        credentialVersion: 1,
      }],
    });

    await handleAccountsCommand(['list', '--json']);

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual([{
      provider: 'claude', name: 'work', current: true, limitedUntil: null,
    }]);
    expect(output).not.toContain('secret-token');
  });

  it('selects a globally unique nickname without requiring a provider', async () => {
    const account = {
      id: '22222222-2222-4222-8222-222222222222',
      provider: 'codex',
      name: 'personal',
      credential: { type: 'auth-file', path: '/managed/codex/personal/auth.json' },
      createdAt: 1,
      updatedAt: 1,
      limitedUntil: null,
      credentialVersion: 3,
    };
    mocks.listCredentialAccounts.mockResolvedValue({ state: {}, accounts: [account] });
    mocks.useCredentialAccount.mockResolvedValue(account);

    await handleAccountsCommand(['use', 'personal']);

    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('codex', 'personal', undefined, {
      id: account.id,
      credentialVersion: 3,
    });
  });

  it('checks the daemon and removes the exact account revision', async () => {
    const account = {
      id: '33333333-3333-4333-8333-333333333333',
      provider: 'grok',
      name: 'work',
      credential: { type: 'auth-file', path: '/managed/grok/work/auth.json' },
      createdAt: 1,
      updatedAt: 1,
      limitedUntil: null,
      credentialVersion: 4,
    };
    mocks.listCredentialAccounts.mockResolvedValue({ state: {}, accounts: [account] });
    mocks.assertMutationAllowed.mockResolvedValue(undefined);
    mocks.removeCredentialAccount.mockResolvedValue(account);

    await handleAccountsCommand(['remove', 'grok', 'work']);

    expect(mocks.assertMutationAllowed).toHaveBeenCalledWith({ provider: 'grok', name: 'work' });
    expect(mocks.removeCredentialAccount).toHaveBeenCalledWith('grok', 'work', undefined, {
      id: account.id,
      credentialVersion: 4,
    });
  });

  it('requires a provider only when the nickname is ambiguous', async () => {
    mocks.listCredentialAccounts.mockResolvedValue({
      state: {},
      accounts: [
        { provider: 'claude', name: 'work' },
        { provider: 'grok', name: 'work' },
      ],
    });

    await expect(handleAccountsCommand(['remove', 'work'])).rejects.toThrow('matches multiple providers');
  });
});
