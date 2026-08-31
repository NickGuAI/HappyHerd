import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const spawn = Object.assign(vi.fn(), { sync: vi.fn() });
  return {
    accountAuthFile: vi.fn((provider: string, name: string) => `/managed/${provider}/${name}/auth.json`),
    accountHome: vi.fn((provider: string, name: string) => `/managed/${provider}/${name}`),
    apiCreate: vi.fn(),
    authenticateClaude: vi.fn(),
    authenticateCodex: vi.fn(),
    authenticateGemini: vi.fn(),
    chmodSync: vi.fn(),
    mkdirSync: vi.fn(),
    readCredentials: vi.fn(),
    registerVendorToken: vi.fn(),
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
vi.mock('@/persistence', () => ({ readCredentials: mocks.readCredentials }));
vi.mock('@/api/api', () => ({ ApiClient: { create: mocks.apiCreate } }));
vi.mock('./connect/authenticateClaude', () => ({ authenticateClaude: mocks.authenticateClaude }));
vi.mock('./connect/authenticateCodex', () => ({ authenticateCodex: mocks.authenticateCodex }));
vi.mock('./connect/authenticateGemini', () => ({ authenticateGemini: mocks.authenticateGemini }));

import { handleConnectCommand } from './connect';

describe('named provider account connection', () => {
  const originalClaudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawn.sync.mockReturnValue({ status: 0 });
    mocks.readCredentials.mockResolvedValue({ token: 'happy-token' });
    mocks.apiCreate.mockResolvedValue({ registerVendorToken: mocks.registerVendorToken });
    mocks.authenticateClaude.mockResolvedValue({ access_token: 'claude-access-token' });
    mocks.authenticateCodex.mockResolvedValue({
      id_token: 'id-token',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      account_id: 'account-id',
    });
    mocks.authenticateGemini.mockResolvedValue({ access_token: 'gemini-access-token' });
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

  it.each([
    {
      label: 'the misspelled account option',
      args: ['claude', '-acct', 'work'],
      error: /Unknown option "-acct"\. Use --acct <nickname>\./,
    },
    {
      label: 'an unknown option',
      args: ['claude', '--account', 'work'],
      error: /Unknown connect option "--account"/,
    },
    {
      label: 'an orphan value',
      args: ['claude', 'work'],
      error: /Unexpected connect argument "work"/,
    },
    {
      label: 'an extra orphan value',
      args: ['claude', '--acct', 'work', 'personal'],
      error: /Unexpected connect argument "personal"/,
    },
    {
      label: 'an option after the nickname',
      args: ['claude', '--acct', 'work', '--unknown'],
      error: /Unknown connect option "--unknown"/,
    },
    {
      label: 'a duplicate account option',
      args: ['codex', '--acct', 'work', '--acct', 'personal'],
      error: /--acct may be specified only once/,
    },
    {
      label: 'a missing nickname',
      args: ['claude', '--acct'],
      error: /Missing nickname after --acct/,
    },
  ])('rejects $label before any authentication side effect', async ({ args, error }) => {
    await expect(handleConnectCommand(args)).rejects.toThrow(error);

    expect(mocks.readCredentials).not.toHaveBeenCalled();
    expect(mocks.apiCreate).not.toHaveBeenCalled();
    expect(mocks.authenticateClaude).not.toHaveBeenCalled();
    expect(mocks.authenticateCodex).not.toHaveBeenCalled();
    expect(mocks.authenticateGemini).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.spawn.sync).not.toHaveBeenCalled();
    expect(mocks.upsertCredentialAccount).not.toHaveBeenCalled();
    expect(mocks.useCredentialAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['claude', 'anthropic'],
    ['codex', 'openai'],
    ['gemini', 'gemini'],
  ] as const)('preserves legacy %s connection with no account option', async (target, vendor) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await handleConnectCommand([target]);

    expect(mocks.readCredentials).toHaveBeenCalledOnce();
    expect(mocks.apiCreate).toHaveBeenCalledOnce();
    expect(mocks.registerVendorToken).toHaveBeenCalledWith(vendor, expect.objectContaining({ oauth: expect.any(Object) }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('prints one Claude authentication transcript while retaining stdin interaction', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mocks.spawn.mockReturnValue(child);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const url = 'https://claude.com/cai/oauth/authorize?state=test-state&code=true';
    const token = 'sk-ant-demo1';

    const connecting = handleConnectCommand(['claude', '--acct', 'work']);
    const firstFrame = Buffer.from(
      '\u001b[?2026hWelcome to Claude Code v2.1.220\n\n'
      + ' · Opening browser to sign in…'
      + '\u001b[2K\u001b[1G\u001b[1AWelcome to Claude Code v2.1.220\n\n'
      + ' ✢ Opening browser to sign in…\n',
    );
    const ellipsis = firstFrame.indexOf(Buffer.from('…'));
    child.stdout.emit('data', firstFrame.subarray(0, ellipsis + 1));
    child.stdout.emit('data', firstFrame.subarray(ellipsis + 1));
    child.stdout.emit('data', Buffer.from(
      'Welcome to Claude Code v2.1.220\n'
      + ' * Opening browser to sign in…\n'
      + 'Browser didn\'t open? Use the url below to sign in (c to copy)\n'
      + `${url}\n`
      + 'Browser didn\'t open? Use the url below to sign in (c to copy)\n'
      + `${url}\n`
      + 'Paste code here if prompted > ',
    ));
    child.stdout.emit('data', Buffer.from(
      '\u001b[2K\u001b[1G\u001b[1AWelcome to Claude Code v2.1.220\n'
      + '\n ✓ Long-lived authentication token created successfully!\n\n'
      + ' Your OAuth token (valid for 1 year):\n\n'
      + ` ${token}\n\n`
      + ' Store this token securely.\n',
    ));
    child.emit('exit', 0);
    child.emit('close', 0);

    await connecting;

    const shown = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(shown.split('Welcome to Claude Code v2.1.220')).toHaveLength(2);
    expect(shown.split('Opening browser to sign in…')).toHaveLength(2);
    expect(shown.split('Browser didn\'t open? Use the url below to sign in (c to copy)')).toHaveLength(2);
    expect(shown.split(url)).toHaveLength(2);
    expect(shown.split('Paste code here if prompted > ')).toHaveLength(2);
    expect(shown.split(token)).toHaveLength(2);
    expect(shown).not.toMatch(/[·✢*] Opening browser/);
    expect(mocks.spawn).toHaveBeenCalledWith('claude', ['setup-token'], expect.objectContaining({
      stdio: ['inherit', 'pipe', 'pipe'],
    }));
    expect(mocks.upsertCredentialAccount).toHaveBeenCalledWith({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token },
    });
    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('claude', 'work');
  });

  it('waits for close before extracting a token from trailing stderr output', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mocks.spawn.mockReturnValue(child);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const token = 'sk-ant-demo2';

    const connecting = handleConnectCommand(['claude', '--acct', 'late-token']);
    child.emit('exit', 0);
    child.stderr.emit('data', Buffer.from(`Final Claude setup output\n${token}`));
    child.emit('close', 0);

    await connecting;

    const shown = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(shown).toContain('Final Claude setup output');
    expect(shown).toContain(token);
    expect(mocks.upsertCredentialAccount).toHaveBeenCalledWith({
      provider: 'claude',
      name: 'late-token',
      credential: { type: 'oauth-token', token },
    });
  });

  it('flushes trailing stderr output on close before rejecting a nonzero exit', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mocks.spawn.mockReturnValue(child);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const connecting = handleConnectCommand(['claude', '--acct', 'failed']);
    const rejected = expect(connecting).rejects.toThrow('claude setup-token exited with status 7');
    child.emit('exit', 7);
    child.stderr.emit('data', Buffer.from('Final Claude setup error'));
    child.emit('close', 7);

    await rejected;

    const shown = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(shown).toContain('Final Claude setup error');
    expect(mocks.upsertCredentialAccount).not.toHaveBeenCalled();
    expect(mocks.useCredentialAccount).not.toHaveBeenCalled();
  });

  it('preserves a child spawn error through close without storing an account', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mocks.spawn.mockReturnValue(child);
    const failure = new Error('could not spawn claude');

    const connecting = handleConnectCommand(['claude', '--acct', 'failed-spawn']);
    const rejected = expect(connecting).rejects.toBe(failure);
    child.emit('error', failure);
    child.emit('close', null);

    await rejected;

    expect(mocks.upsertCredentialAccount).not.toHaveBeenCalled();
    expect(mocks.useCredentialAccount).not.toHaveBeenCalled();
  });
});
