import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateCodex: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('cross-spawn', () => ({
  default: Object.assign(vi.fn(), { sync: mocks.spawnSync }),
}));
vi.mock('./connect/authenticateCodex', () => ({ authenticateCodex: mocks.authenticateCodex }));

import { sanitizeGrokChildEnvironment } from '@/agent/acp/acpAgentConfig';
import { activateCredentialAccount } from '@/credentialPool/activate';
import { persistActiveGrokCredential } from '@/credentialPool/grokAuth';
import {
  credentialAccountEnvironment,
  readCredentialPoolState,
  type CredentialPoolPaths,
} from '@/credentialPool/store';
import { handleConnectCommand } from './connect';

describe('named credential files from connect through provider launch', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('GROK_AUTH_PATH', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    root = await mkdtemp(join(tmpdir(), 'happy-connect-credentials-'));
    paths = {
      stateFile: join(root, 'credential-pools.json'),
      accountsDir: join(root, 'credential-pools'),
    };
    mocks.authenticateCodex.mockResolvedValue({
      id_token: 'id-token',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      account_id: 'account-id',
    });
    mocks.spawnSync.mockImplementation((_command, _args, options: { env: NodeJS.ProcessEnv }) => {
      const home = options.env.GROK_HOME;
      if (!home) throw new Error('GROK_HOME was not supplied to grok login');
      mkdirSync(home, { recursive: true });
      // Match native Grok storage.rs: a nonempty auth override wins over GROK_HOME.
      const authFile = options.env.GROK_AUTH_PATH || join(home, 'auth.json');
      writeFileSync(authFile, JSON.stringify({ account: `login-${mocks.spawnSync.mock.calls.length}` }), { mode: 0o666 });
      chmodSync(authFile, 0o664);
      return { status: 0 };
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it.each(['inherited', 'empty', 'unset'] as const)(
    'registers and selects a new Grok account without changing existing auth (%s override)',
    async (override) => {
      await handleConnectCommand(['grok', '--acct', 'existing-A'], { credentialPoolPaths: paths });
      const before = await readCredentialPoolState(paths);
      const existing = before.accounts[0];
      if (existing.provider !== 'grok') throw new Error('missing existing Grok account');
      const existingBytes = await readFile(existing.credential.path);
      const inheritedHome = join(root, 'inherited-grok-home');
      mkdirSync(inheritedHome);
      const inheritedAuth = join(inheritedHome, 'auth.json');
      writeFileSync(inheritedAuth, existingBytes);
      const inheritedPath = override === 'inherited' ? existing.credential.path : override === 'empty' ? '' : undefined;
      vi.stubEnv('GROK_HOME', inheritedHome);
      vi.stubEnv('GROK_AUTH_PATH', inheritedPath);
      const newAuth = Buffer.from(`${JSON.stringify({
        'https://auth.x.ai::terminal-test-client': {
          key: 'fake-new-B-access', refresh_token: 'fake-new-B-refresh', auth_mode: 'oauth',
        },
      }, null, 2)}\n`);
      mocks.spawnSync.mockImplementationOnce((_command, _args, options: { env: NodeJS.ProcessEnv }) => {
        const authFile = options.env.GROK_AUTH_PATH || join(options.env.GROK_HOME!, 'auth.json');
        writeFileSync(authFile, newAuth);
        return { status: 0 };
      });

      await handleConnectCommand(['grok', '--acct', 'new-B'], { credentialPoolPaths: paths });

      const after = await readCredentialPoolState(paths);
      expect(after.accounts).toHaveLength(2);
      expect(after.accounts.find((account) => account.id === existing.id)).toEqual(existing);
      expect(await readFile(existing.credential.path)).toEqual(existingBytes);
      expect(await readFile(inheritedAuth)).toEqual(existingBytes);
      const registered = after.accounts.find((account) => account.name === 'new-B');
      expect(registered).toMatchObject({ provider: 'grok', name: 'new-B', credentialVersion: 1 });
      if (!registered || registered.provider !== 'grok') throw new Error('missing new Grok account');
      expect(registered.id).not.toBe(existing.id);
      expect(await readFile(registered.credential.path)).toEqual(newAuth);
      expect(after.current.grok).toBe('new-B');
      expect((await stat(registered.credential.path)).mode & 0o777).toBe(0o600);
      expect(await readdir(join(paths.accountsDir, '.pending'))).toEqual([]);
      expect(process.env.GROK_HOME).toBe(inheritedHome);
      expect(process.env.GROK_AUTH_PATH).toBe(inheritedPath);
      const childEnv = mocks.spawnSync.mock.calls[1][2].env;
      expect(childEnv).not.toHaveProperty('GROK_AUTH_PATH');
      expect(childEnv.GROK_HOME).toContain(join(paths.accountsDir, '.pending', 'terminal-'));
      expect(childEnv.PATH).toBe(process.env.PATH);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Connected and selected grok account "new-B".'));
    },
  );

  it.each([
    { label: 'nonzero exit', result: { status: 7 }, message: 'grok login exited with status 7' },
    { label: 'spawn error', result: { status: null, error: new Error('could not spawn grok') }, message: 'could not spawn grok' },
    { label: 'missing staged auth', result: { status: 0 }, message: 'ENOENT' },
  ])('preserves existing auth and selection and removes staging after $label', async ({ result, message }) => {
    await handleConnectCommand(['grok', '--acct', 'existing-A'], { credentialPoolPaths: paths });
    const before = await readCredentialPoolState(paths);
    const existing = before.accounts[0];
    if (existing.provider !== 'grok') throw new Error('missing existing Grok account');
    const existingAuth = existing.credential.path;
    const existingBytes = await readFile(existingAuth);
    vi.stubEnv('GROK_AUTH_PATH', existingAuth);
    mocks.spawnSync.mockReturnValueOnce(result);

    await expect(handleConnectCommand(['grok', '--acct', 'new-B'], {
      credentialPoolPaths: paths,
    })).rejects.toThrow(message);

    expect(await readCredentialPoolState(paths)).toEqual(before);
    expect(await readFile(existingAuth)).toEqual(existingBytes);
    expect(await readdir(join(paths.accountsDir, '.pending'))).toEqual([]);
    expect(process.env.GROK_AUTH_PATH).toBe(existingAuth);
    expect(mocks.spawnSync.mock.calls[1][2].env).not.toHaveProperty('GROK_AUTH_PATH');
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Connected and selected grok account "new-B".'));
  });

  it('rotates two Grok auth files inside one stable runtime home without moving session state', async () => {
    await handleConnectCommand(['grok', '--acct', 'work'], { credentialPoolPaths: paths });
    await handleConnectCommand(['grok', '--acct', 'personal'], { credentialPoolPaths: paths });

    const state = await readCredentialPoolState(paths);
    const grokAccounts = state.accounts.filter((account) => account.provider === 'grok');
    expect(grokAccounts).toHaveLength(2);
    for (const account of grokAccounts) {
      expect(account.credential.path).toBe(join(paths.accountsDir, 'grok', account.id, 'auth.json'));
    }
    const accountPath = (name: string): string => {
      const account = grokAccounts.find((candidate) => candidate.name === name);
      if (!account) throw new Error(`missing ${name}`);
      return account.credential.path;
    };

    const stableRuntimeHome = join(root, 'grok-runtime');
    const sessionFile = join(stableRuntimeHome, 'sessions', 'provider-session.json');
    mkdirSync(join(stableRuntimeHome, 'sessions'), { recursive: true });
    writeFileSync(sessionFile, JSON.stringify({ session: 'same-provider-session' }));

    const activate = async (name: string, expectedAccount: string): Promise<NodeJS.ProcessEnv> => {
      const accountAuthPath = accountPath(name);
      const accountHomePath = dirname(accountAuthPath);
      const launchEnvironment: NodeJS.ProcessEnv = {
        HOME: '/home/test',
        PATH: '/usr/bin',
        GROK_HOME: stableRuntimeHome,
        HAPPYHERD_PROVIDER_ACCOUNT: name,
        HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'grok',
      };
      await activateCredentialAccount('grok', { paths, env: launchEnvironment });
      const childEnvironment = sanitizeGrokChildEnvironment(launchEnvironment);

      expect(childEnvironment.GROK_HOME).toBe(stableRuntimeHome);
      expect(childEnvironment.GROK_AUTH_PATH).toBe(launchEnvironment.GROK_AUTH_PATH);
      expect(launchEnvironment.GROK_AUTH_PATH).toContain('/.happyherd-runtime-auth/');
      expect(launchEnvironment.GROK_AUTH_PATH).toMatch(/\/v1\/auth\.json$/);
      expect(launchEnvironment.HAPPYHERD_GROK_ACCOUNT_AUTH_FILE).toBe(accountAuthPath);
      expect(JSON.parse(await readFile(accountAuthPath, 'utf8'))).toMatchObject({
        account: expectedAccount,
      });
      expect(JSON.parse(await readFile(sessionFile, 'utf8'))).toEqual({ session: 'same-provider-session' });
      expect((await stat(paths.accountsDir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(paths.accountsDir, 'grok'))).mode & 0o777).toBe(0o700);
      expect((await stat(accountHomePath)).mode & 0o777).toBe(0o700);
      expect((await stat(accountAuthPath)).mode & 0o777).toBe(0o600);
      expect((await stat(launchEnvironment.GROK_AUTH_PATH!)).mode & 0o777).toBe(0o600);
      await expect(readFile(join(stableRuntimeHome, 'auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      return launchEnvironment;
    };

    const workEnvironment = await activate('work', 'login-1');
    const workRuntimeAuthPath = workEnvironment.GROK_AUTH_PATH!;
    expect(JSON.parse(await readFile(workRuntimeAuthPath, 'utf8'))).toEqual({ account: 'login-1' });
    writeFileSync(
      workRuntimeAuthPath,
      JSON.stringify({ account: 'work', accessToken: 'refreshed' }),
    );
    chmodSync(workRuntimeAuthPath, 0o664);
    await expect(persistActiveGrokCredential(workEnvironment, paths)).resolves.toBe(true);
    expect(JSON.parse(await readFile(accountPath('work'), 'utf8'))).toEqual({
      account: 'work',
      accessToken: 'refreshed',
    });
    expect((await stat(workRuntimeAuthPath)).mode & 0o777).toBe(0o600);
    expect((await stat(accountPath('work'))).mode & 0o777).toBe(0o600);

    const personalEnvironment = await activate('personal', 'login-2');
    expect(personalEnvironment.GROK_AUTH_PATH).not.toBe(workRuntimeAuthPath);
    expect(JSON.parse(await readFile(personalEnvironment.GROK_AUTH_PATH!, 'utf8'))).toEqual({ account: 'login-2' });
    await expect(persistActiveGrokCredential(workEnvironment, paths)).resolves.toBe(true);
    expect(JSON.parse(await readFile(accountPath('work'), 'utf8'))).toEqual({
      account: 'work',
      accessToken: 'refreshed',
    });
    writeFileSync(personalEnvironment.GROK_AUTH_PATH!, JSON.stringify({ account: 'personal', accessToken: 'fresh' }));
    await expect(persistActiveGrokCredential(personalEnvironment, paths)).resolves.toBe(true);
    expect(JSON.parse(await readFile(accountPath('personal'), 'utf8'))).toEqual({
      account: 'personal',
      accessToken: 'fresh',
    });
    const resumedWorkEnvironment = await activate('work', 'work');
    expect(resumedWorkEnvironment.GROK_AUTH_PATH).toBe(workRuntimeAuthPath);
    expect(JSON.parse(await readFile(workRuntimeAuthPath, 'utf8'))).toEqual({
      account: 'work',
      accessToken: 'refreshed',
    });
    await expect(readFile(join(stableRuntimeHome, 'auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(sessionFile, 'utf8'))).toEqual({ session: 'same-provider-session' });
  });

  it('writes the managed Codex auth file and directory owner-only', async () => {
    await handleConnectCommand(['codex', '--acct', 'work'], { credentialPoolPaths: paths });

    const account = (await readCredentialPoolState(paths)).accounts.find(
      (candidate) => candidate.provider === 'codex' && candidate.name === 'work',
    );
    if (!account || account.provider !== 'codex') throw new Error('missing Codex account');
    const authFile = account.credential.path;
    expect(JSON.parse(await readFile(authFile, 'utf8'))).toMatchObject({
      tokens: { account_id: 'account-id' },
    });
    expect((await stat(paths.accountsDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(paths.accountsDir, 'codex'))).mode & 0o777).toBe(0o700);
    expect((await stat(dirname(authFile))).mode & 0o777).toBe(0o700);
    expect((await stat(authFile)).mode & 0o777).toBe(0o600);
  });

  it('bumps the credential version on terminal relogin so an old session cannot overwrite it', async () => {
    await handleConnectCommand(['codex', '--acct', 'work'], { credentialPoolPaths: paths });
    const first = (await readCredentialPoolState(paths)).accounts.find(
      (candidate) => candidate.provider === 'codex' && candidate.name === 'work',
    );
    if (!first || first.provider !== 'codex') throw new Error('missing first Codex account');
    const assertMutationAllowed = vi.fn(async () => undefined);

    mocks.authenticateCodex.mockResolvedValueOnce({
      id_token: 'new-id-token',
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      account_id: 'new-account-id',
    });
    await handleConnectCommand(['codex', '--acct', 'work'], {
      credentialPoolPaths: paths,
      assertMutationAllowed,
    });

    const current = (await readCredentialPoolState(paths)).accounts.find(
      (candidate) => candidate.provider === 'codex' && candidate.name === 'work',
    );
    if (!current || current.provider !== 'codex') throw new Error('missing current Codex account');
    expect(assertMutationAllowed).toHaveBeenCalledWith({ provider: 'codex', name: 'work' });
    expect(current.id).toBe(first.id);
    expect(current.credentialVersion).toBe(first.credentialVersion + 1);
    expect(await readFile(current.credential.path, 'utf8')).toContain('new-access-token');
  });
});
