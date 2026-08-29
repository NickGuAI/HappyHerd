import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const spawn = Object.assign(vi.fn(), { sync: vi.fn() });
  return {
    accountAuthFile: vi.fn((provider: string, name: string) => `/managed/${provider}/${name}/auth.json`),
    accountHome: vi.fn((provider: string, name: string) => `/managed/${provider}/${name}`),
    authenticateCodex: vi.fn(),
    chmodSync: vi.fn(),
    mkdirSync: vi.fn(),
    spawn,
    upsertCredentialAccount: vi.fn(),
    useCredentialAccount: vi.fn(),
    validateAccountName: vi.fn((name: string) => name),
    writeFileSync: vi.fn(),
  };
});

vi.mock('cross-spawn', () => ({ default: mocks.spawn }));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  chmodSync: mocks.chmodSync,
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}));
vi.mock('@/credentialPool/store', () => ({
  accountAuthFile: mocks.accountAuthFile,
  accountHome: mocks.accountHome,
  upsertCredentialAccount: mocks.upsertCredentialAccount,
  useCredentialAccount: mocks.useCredentialAccount,
  validateAccountName: mocks.validateAccountName,
}));
vi.mock('./connect/authenticateCodex', () => ({ authenticateCodex: mocks.authenticateCodex }));

import { handleConnectCommand } from './connect';

describe('named provider account connection', () => {
  const originalClaudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawn.sync.mockReturnValue({ status: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClaudeToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalClaudeToken;
  });

  it('retains a named Claude setup token and selects the account', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'claude-setup-token';

    await handleConnectCommand(['claude', '--acct', 'work']);

    expect(mocks.upsertCredentialAccount).toHaveBeenCalledWith({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token: 'claude-setup-token' },
    });
    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('claude', 'work');
  });

  it('writes Codex OAuth material into the named account home', async () => {
    mocks.authenticateCodex.mockResolvedValue({
      id_token: 'id-token',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      account_id: 'account-id',
    });

    await handleConnectCommand(['codex', '--acct', 'personal']);

    expect(mocks.mkdirSync).toHaveBeenCalledWith('/managed/codex/personal', { recursive: true, mode: 0o700 });
    const [path, contents, options] = mocks.writeFileSync.mock.calls[0];
    expect(path).toBe('/managed/codex/personal/auth.json');
    expect(options).toEqual({ encoding: 'utf8', mode: 0o600 });
    expect(JSON.parse(contents)).toMatchObject({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id',
      },
    });
    expect(mocks.upsertCredentialAccount).toHaveBeenCalledWith({
      provider: 'codex',
      name: 'personal',
      credential: { type: 'auth-file', path: '/managed/codex/personal/auth.json' },
    });
  });

  it('runs Grok login in the named account home', async () => {
    await handleConnectCommand(['grok', '--acct', 'backup']);

    expect(mocks.spawn.sync).toHaveBeenCalledWith('grok', ['login'], expect.objectContaining({
      env: expect.objectContaining({ GROK_HOME: '/managed/grok/backup' }),
    }));
    expect(mocks.upsertCredentialAccount).toHaveBeenCalledWith({
      provider: 'grok',
      name: 'backup',
      credential: { type: 'auth-file', path: '/managed/grok/backup/auth.json' },
    });
    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('grok', 'backup');
  });
});
