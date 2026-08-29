import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCredentialAccounts: vi.fn(),
  removeCredentialAccount: vi.fn(),
  useCredentialAccount: vi.fn(),
}));

vi.mock('@/credentialPool/store', () => mocks);

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
      state: { schemaVersion: 1, current: { claude: 'work' }, accounts: [] },
      accounts: [{
        provider: 'claude',
        name: 'work',
        credential: { type: 'oauth-token', token: 'secret-token' },
        createdAt: 1,
        updatedAt: 1,
        limitedUntil: null,
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
      provider: 'codex',
      name: 'personal',
      credential: { type: 'auth-file', path: '/managed/codex/personal/auth.json' },
      createdAt: 1,
      updatedAt: 1,
      limitedUntil: null,
    };
    mocks.listCredentialAccounts.mockResolvedValue({ state: {}, accounts: [account] });
    mocks.useCredentialAccount.mockResolvedValue(account);

    await handleAccountsCommand(['use', 'personal']);

    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('codex', 'personal');
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
