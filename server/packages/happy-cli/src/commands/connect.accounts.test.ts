import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const spawn = Object.assign(vi.fn(), { sync: vi.fn() });
  const credentialPoolPaths = {
    stateFile: '/managed/credential-pools.json',
    accountsDir: '/managed/accounts',
  };
  return {
    apiCreate: vi.fn(),
    authenticateClaude: vi.fn(),
    authenticateCodex: vi.fn(),
    authenticateGemini: vi.fn(),
    chmod: vi.fn(),
    commitCredentialLogin: vi.fn(async (
      input: { provider: string; name: string; token?: string; authFile?: Buffer },
      _options?: unknown,
    ) => ({
      id: '00000000-0000-4000-8000-000000000001',
      provider: input.provider,
      name: input.name,
      credential: input.provider === 'claude'
        ? { type: 'oauth-token', token: 'stored-token' }
        : { type: 'auth-file', path: `/managed/accounts/${input.provider}/account-id/auth.json` },
      credentialVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      limitedUntil: null,
    })),
    credentialPoolPaths,
    defaultCredentialPoolPaths: vi.fn(() => credentialPoolPaths),
    listCredentialAccounts: vi.fn(async () => ({ state: {}, accounts: [] })),
    mkdir: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtemp: vi.fn(async () => '/managed/accounts/.pending/terminal-test'),
    readFile: vi.fn(async () => Buffer.from('{"token":"grok-token"}')),
    readCredentials: vi.fn(),
    registerVendorToken: vi.fn(),
    rm: vi.fn(),
    spawn,
    useCredentialAccount: vi.fn(),
    validateAccountName: vi.fn((name: string) => name),
    writeFileSync: vi.fn(),
  };
});

vi.mock('cross-spawn', () => ({ default: mocks.spawn }));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}));
vi.mock('node:fs/promises', () => ({
  chmod: mocks.chmod,
  mkdir: mocks.mkdir,
  mkdtemp: mocks.mkdtemp,
  readFile: mocks.readFile,
  rm: mocks.rm,
}));
vi.mock('@/credentialPool/store', () => ({
  commitCredentialLogin: mocks.commitCredentialLogin,
  defaultCredentialPoolPaths: mocks.defaultCredentialPoolPaths,
  listCredentialAccounts: mocks.listCredentialAccounts,
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

    expect(mocks.commitCredentialLogin).toHaveBeenCalledWith({
      provider: 'claude',
      name: 'work',
      token: 'claude-setup-token',
    }, { paths: mocks.credentialPoolPaths, target: { type: 'new' } });
    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('claude', 'work', mocks.credentialPoolPaths, {
      id: '00000000-0000-4000-8000-000000000001', credentialVersion: 1,
    });
  });

  it('commits Codex OAuth material through the credential pool owner', async () => {
    await handleConnectCommand(['codex', '--acct', 'personal']);

    const [input, options] = mocks.commitCredentialLogin.mock.calls[0];
    expect(input).toMatchObject({ provider: 'codex', name: 'personal' });
    expect(JSON.parse(input.authFile!.toString('utf8'))).toMatchObject({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id',
      },
    });
    expect(options).toEqual({ paths: mocks.credentialPoolPaths, target: { type: 'new' } });
    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('codex', 'personal', mocks.credentialPoolPaths, {
      id: '00000000-0000-4000-8000-000000000001', credentialVersion: 1,
    });
  });

  it('runs Grok login in the named account home', async () => {
    await handleConnectCommand(['grok', '--acct', 'backup']);

    expect(mocks.spawn.sync).toHaveBeenCalledWith('grok', ['login'], expect.objectContaining({
      env: expect.objectContaining({ GROK_HOME: '/managed/accounts/.pending/terminal-test' }),
    }));
    expect(mocks.mkdir).toHaveBeenCalledWith('/managed/accounts/.pending', { recursive: true, mode: 0o700 });
    expect(mocks.chmod).toHaveBeenCalledWith('/managed/accounts/.pending', 0o700);
    expect(mocks.readFile).toHaveBeenCalledWith('/managed/accounts/.pending/terminal-test/auth.json');
    expect(mocks.commitCredentialLogin).toHaveBeenCalledWith({
      provider: 'grok',
      name: 'backup',
      authFile: Buffer.from('{"token":"grok-token"}'),
    }, { paths: mocks.credentialPoolPaths, target: { type: 'new' } });
    expect(mocks.rm).toHaveBeenCalledWith('/managed/accounts/.pending/terminal-test', {
      recursive: true,
      force: true,
    });
    expect(mocks.useCredentialAccount).toHaveBeenCalledWith('grok', 'backup', mocks.credentialPoolPaths, {
      id: '00000000-0000-4000-8000-000000000001', credentialVersion: 1,
    });
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
    expect(mocks.commitCredentialLogin).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
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
    expect(mocks.commitCredentialLogin).toHaveBeenCalledWith({
      provider: 'claude',
      name: 'work',
      token,
    }, { paths: mocks.credentialPoolPaths, target: { type: 'new' } });
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
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    child.emit('exit', 0);
    child.stderr.emit('data', Buffer.from(`Final Claude setup output\n${token}`));
    child.emit('close', 0);

    await connecting;

    const shown = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(shown).toContain('Final Claude setup output');
    expect(shown).toContain(token);
    expect(mocks.commitCredentialLogin).toHaveBeenCalledWith({
      provider: 'claude',
      name: 'late-token',
      token,
    }, { paths: mocks.credentialPoolPaths, target: { type: 'new' } });
  });

  it('flushes trailing stderr output on close before rejecting a nonzero exit', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mocks.spawn.mockReturnValue(child);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const connecting = handleConnectCommand(['claude', '--acct', 'failed']);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    child.emit('exit', 7);
    child.stderr.emit('data', Buffer.from('Final Claude setup error'));
    child.emit('close', 7);

    await expect(connecting).rejects.toThrow('claude setup-token exited with status 7');

    const shown = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(shown).toContain('Final Claude setup error');
    expect(mocks.commitCredentialLogin).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    child.emit('error', failure);
    child.emit('close', null);

    await expect(connecting).rejects.toBe(failure);

    expect(mocks.commitCredentialLogin).not.toHaveBeenCalled();
    expect(mocks.useCredentialAccount).not.toHaveBeenCalled();
  });
});
