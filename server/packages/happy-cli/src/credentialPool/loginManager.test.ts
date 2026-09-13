import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCredentialPoolState, upsertCredentialAccount, type CredentialPoolPaths } from './store';
import { CredentialLoginManager } from './loginManager';

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    kill: vi.fn(),
  });
  child.kill.mockImplementation(() => {
    queueMicrotask(() => {
      child.exitCode = 143;
      child.emit('close', null);
    });
    return true;
  });
  return child;
}

describe('credential provider login manager', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-credential-login-'));
    paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('uses Codex device auth and commits only after a valid staged artifact', async () => {
    const child = fakeChild();
    let stagedHome = '';
    const spawn = vi.fn((_command, _args, options) => {
      stagedHome = options.env.CODEX_HOME;
      return child;
    });
    const manager = new CredentialLoginManager({ paths, spawn: spawn as any });

    const started = await manager.start('codex', 'personal');
    child.stdout.write(
      '1. Open https://auth.openai.com/codex/device\n'
      + '2. Enter this one-time code (expires in 15 minutes)\n'
      + 'ABCD-EFGH',
    );
    expect(manager.status(started.id)).toMatchObject({
      state: 'waiting-user',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
    });
    expect((await readCredentialPoolState(paths)).accounts).toEqual([]);

    await mkdir(stagedHome, { recursive: true });
    await writeFile(join(stagedHome, 'auth.json'), '{"tokens":{"access_token":"private"}}');
    child.emit('close', 0);
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('succeeded'));

    const state = await readCredentialPoolState(paths);
    expect(state.current.codex).toBe('personal');
    const account = state.accounts[0];
    expect(account).toMatchObject({ provider: 'codex', name: 'personal' });
    expect(JSON.stringify(manager.status(started.id))).not.toContain('private');
    if (account.provider !== 'codex') throw new Error('expected Codex account');
    expect((await stat(account.credential.path)).mode & 0o777).toBe(0o600);
  });

  it('submits a Claude one-time code without exposing the resulting token', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const manager = new CredentialLoginManager({ paths, spawn: spawn as any });
    const started = await manager.start('claude', 'work');
    child.stdout.write('Sign in at https://claude.com/cai/oauth/authorize?state=demo\nPaste code here if prompted > ');
    expect(manager.status(started.id)).toMatchObject({ state: 'waiting-user', requiresCodeEntry: true });

    const input: string[] = [];
    child.stdin.on('data', (chunk) => input.push(String(chunk)));
    await manager.submitCode(started.id, 'one-time-code');
    expect(input.join('')).toBe('one-time-code\n');
    child.stdout.write('\nLong-lived authentication token created\nsk-ant-private-token\n');
    child.emit('close', 0);
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('succeeded'));

    const account = (await readCredentialPoolState(paths)).accounts[0];
    expect(account).toMatchObject({ provider: 'claude', name: 'work' });
    expect(JSON.stringify(manager.status(started.id))).not.toContain('sk-ant-private-token');
  });

  it('cancels a staged login without replacing an existing account', async () => {
    await upsertCredentialAccount({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token: 'existing-token' },
    }, { paths, now: 1 });
    const child = fakeChild();
    const manager = new CredentialLoginManager({ paths, spawn: vi.fn(() => child) as any });
    const started = await manager.start('claude', 'work');

    await expect(manager.cancel(started.id)).resolves.toMatchObject({ state: 'canceled' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    const account = (await readCredentialPoolState(paths)).accounts[0];
    expect(account.provider === 'claude' && account.credential.token).toBe('existing-token');
  });

  it('reports a bounded failure and never stores provider output', async () => {
    const child = fakeChild();
    const manager = new CredentialLoginManager({ paths, spawn: vi.fn(() => child) as any });
    const started = await manager.start('grok', 'failed');
    child.stderr.write('provider failed with secret=do-not-return');
    child.emit('close', 7);
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('failed'));
    expect(JSON.stringify(manager.status(started.id))).not.toContain('do-not-return');
    expect((await readCredentialPoolState(paths)).accounts).toEqual([]);
  });

  it('sanitizes ambient credentials and accepts only exact provider login URLs', async () => {
    for (const key of [
      'OPENAI_API_KEY',
      'CODEX_ACCESS_TOKEN',
      'CODEX_AUTH',
      'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
      'CLAUDE_BRIDGE_OAUTH_TOKEN',
      'GROK_CODE_XAI_API_KEY',
      'GROK_DEPLOYMENT_KEY',
      'GROK_AUTH_PROVIDER_ACCESS_TOKEN',
    ]) vi.stubEnv(key, `ambient-${key}`);
    vi.stubEnv('HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE', '/private/auth.json');
    const child = fakeChild();
    const spawn = vi.fn((_command, _args, options) => {
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      expect(options.env.CODEX_ACCESS_TOKEN).toBeUndefined();
      expect(options.env.CODEX_AUTH).toBeUndefined();
      expect(options.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBeUndefined();
      expect(options.env.CLAUDE_BRIDGE_OAUTH_TOKEN).toBeUndefined();
      expect(options.env.GROK_CODE_XAI_API_KEY).toBeUndefined();
      expect(options.env.GROK_DEPLOYMENT_KEY).toBeUndefined();
      expect(options.env.GROK_AUTH_PROVIDER_ACCESS_TOKEN).toBeUndefined();
      expect(options.env.HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE).toBeUndefined();
      expect(options.env.CODEX_HOME).toContain('/.pending/');
      return child;
    });
    const manager = new CredentialLoginManager({ paths, spawn: spawn as any });
    const started = await manager.start('codex', 'safe');
    child.stdout.write(
      'Open https://evil.test/?next=https://auth.openai.com/codex/device), then '
      + 'https://auth.openai.com/codex/device. Enter ABCD-EFGH-IJKL',
    );
    expect(manager.status(started.id)).toMatchObject({
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH-IJKL',
    });
    await manager.cancel(started.id);
  });

  it('isolates Claude setup-token inside a staging config directory', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/private/existing-claude');
    vi.stubEnv('CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'ambient-refresh');
    const child = fakeChild();
    let stagingHome = '';
    const manager = new CredentialLoginManager({
      paths,
      spawn: vi.fn((_command, _args, options) => {
        stagingHome = options.env.CLAUDE_CONFIG_DIR;
        expect(stagingHome).toContain('/.pending/');
        expect(options.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
        return child;
      }) as any,
    });
    const started = await manager.start('claude', 'isolated');
    expect((await stat(stagingHome)).isDirectory()).toBe(true);
    await manager.cancel(started.id);
  });

  it('reserves a target before setup and caps concurrent login processes', async () => {
    const children = Array.from({ length: 3 }, () => fakeChild());
    const spawn = vi.fn(() => children.shift()!);
    const manager = new CredentialLoginManager({ paths, spawn: spawn as any });
    const [first, duplicate] = await Promise.allSettled([
      manager.start('claude', 'same'),
      manager.start('claude', 'same'),
    ]);
    expect([first.status, duplicate.status].sort()).toEqual(['fulfilled', 'rejected']);
    await manager.start('codex', 'second');
    await manager.start('grok', 'third');
    await expect(manager.start('claude', 'fourth')).rejects.toThrow('Too many');
    expect(spawn).toHaveBeenCalledTimes(3);
    await manager.dispose();
  });

  it('releases a failed spawn reservation so the same target can retry', async () => {
    const child = fakeChild();
    const spawn = vi.fn()
      .mockImplementationOnce(() => { throw new Error('spawn details'); })
      .mockReturnValueOnce(child);
    const manager = new CredentialLoginManager({ paths, spawn: spawn as any });
    await expect(manager.start('grok', 'retry')).rejects.toThrow('could not be started');
    const started = await manager.start('grok', 'retry');
    await manager.cancel(started.id);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('rejects empty or metadata-only auth artifacts and multiline Claude codes', async () => {
    const codexChild = fakeChild();
    let stagedHome = '';
    const manager = new CredentialLoginManager({
      paths,
      spawn: vi.fn((_command, _args, options) => {
        stagedHome = options.env.CODEX_HOME;
        return codexChild;
      }) as any,
    });
    const started = await manager.start('codex', 'empty');
    await writeFile(join(stagedHome, 'auth.json'), '{}');
    codexChild.exitCode = 0;
    codexChild.emit('close', 0);
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('failed'));

    const metadataChild = fakeChild();
    let metadataHome = '';
    const metadataManager = new CredentialLoginManager({
      paths,
      spawn: vi.fn((_command, _args, options) => {
        metadataHome = options.env.CODEX_HOME;
        return metadataChild;
      }) as any,
    });
    const metadataStarted = await metadataManager.start('codex', 'metadata');
    await writeFile(join(metadataHome, 'auth.json'), '{"tokens":{"account_id":"not-a-bearer-token"}}');
    metadataChild.exitCode = 0;
    metadataChild.emit('close', 0);
    await vi.waitFor(() => expect(metadataManager.status(metadataStarted.id).state).toBe('failed'));

    const claudeChild = fakeChild();
    const claude = new CredentialLoginManager({ paths, spawn: vi.fn(() => claudeChild) as any });
    const claudeStarted = await claude.start('claude', 'code');
    claudeChild.stdout.write('https://claude.com/cai/oauth/authorize\nPaste code here if prompted > ');
    await expect(claude.submitCode(claudeStarted.id, 'first\nsecond')).rejects.toThrow('one-time code');
    await claude.cancel(claudeStarted.id);
  });

  it('keeps a target reserved through commit and waits for it during disposal', async () => {
    const child = fakeChild();
    let stagedHome = '';
    let releaseCommit!: () => void;
    let signalCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolveStarted) => { signalCommitStarted = resolveStarted; });
    const commitBarrier = new Promise<void>((resolveCommit) => { releaseCommit = resolveCommit; });
    const commitLogin = vi.fn(async () => {
      signalCommitStarted();
      await commitBarrier;
      return {} as any;
    });
    const manager = new CredentialLoginManager({
      paths,
      commitLogin,
      spawn: vi.fn((_command, _args, options) => {
        stagedHome = options.env.CODEX_HOME;
        return child;
      }) as any,
    });
    const started = await manager.start('codex', 'reserved');
    await writeFile(join(stagedHome, 'auth.json'), '{"tokens":{"access_token":"private"}}');
    child.exitCode = 0;
    child.emit('close', 0);
    await commitStarted;

    await expect(manager.start('codex', 'reserved')).rejects.toThrow('already in progress');
    await expect(manager.withTargetReservations(
      [{ provider: 'codex', name: 'reserved' }],
      async () => undefined,
    )).rejects.toThrow('Cancel the active login');

    let disposed = false;
    const disposal = manager.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    releaseCommit();
    await disposal;
    expect(commitLogin).toHaveBeenCalledTimes(1);
  });

  it('accepts the installed Grok device-auth credential shape', async () => {
    const child = fakeChild();
    let stagedHome = '';
    const manager = new CredentialLoginManager({
      paths,
      spawn: vi.fn((_command, _args, options) => {
        stagedHome = options.env.GROK_HOME;
        return child;
      }) as any,
    });
    const started = await manager.start('grok', 'work');
    await writeFile(
      join(stagedHome, 'auth.json'),
      JSON.stringify({ 'https://accounts.x.ai/sign-in': { key: 'private-grok-key' } }),
    );
    child.exitCode = 0;
    child.emit('close', 0);
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('succeeded'));
    expect(JSON.stringify(manager.status(started.id))).not.toContain('private-grok-key');
  });

  it('drains a login that is still preparing and never spawns after disposal starts', async () => {
    let releasePreparation!: () => void;
    let signalPreparation!: () => void;
    const preparationStarted = new Promise<void>((resolve) => { signalPreparation = resolve; });
    const preparationBarrier = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const spawn = vi.fn(() => fakeChild());
    const manager = new CredentialLoginManager({
      paths,
      spawn: spawn as any,
      prepareStagingHome: async (home) => {
        signalPreparation();
        await preparationBarrier;
        await mkdir(home, { recursive: true });
      },
    });

    const starting = manager.start('codex', 'preparing');
    await preparationStarted;
    let disposed = false;
    const disposal = manager.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    releasePreparation();

    await expect(starting).rejects.toThrow('could not be started');
    await disposal;
    expect(spawn).not.toHaveBeenCalled();
    await expect(manager.start('codex', 'later')).rejects.toThrow('shutting down');
    await expect(manager.withTargetReservations(
      [{ provider: 'codex', name: 'later' }],
      async () => undefined,
    )).rejects.toThrow('shutting down');
  });

  it('waits for a reserved account mutation before disposal completes', async () => {
    let releaseMutation!: () => void;
    let signalMutation!: () => void;
    const mutationStarted = new Promise<void>((resolve) => { signalMutation = resolve; });
    const mutationBarrier = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const manager = new CredentialLoginManager({ paths });
    const mutation = manager.withTargetReservations(
      [{ provider: 'grok', name: 'work' }],
      async () => {
        signalMutation();
        await mutationBarrier;
        return 'done';
      },
    );
    await mutationStarted;

    let disposed = false;
    const disposal = manager.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    releaseMutation();

    await expect(mutation).resolves.toBe('done');
    await disposal;
    expect(disposed).toBe(true);
  });
});
