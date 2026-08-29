import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
  accountAuthFile,
  accountHome,
  readCredentialPoolState,
  type CredentialPoolPaths,
} from '@/credentialPool/store';
import { handleConnectCommand } from './connect';

describe('named credential files from connect through provider launch', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    vi.clearAllMocks();
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
      const authFile = join(home, 'auth.json');
      writeFileSync(authFile, JSON.stringify({ account: basename(home) }), { mode: 0o666 });
      chmodSync(authFile, 0o664);
      return { status: 0 };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('rotates two Grok auth files inside one stable runtime home without moving session state', async () => {
    await handleConnectCommand(['grok', '--acct', 'work'], { credentialPoolPaths: paths });
    await handleConnectCommand(['grok', '--acct', 'personal'], { credentialPoolPaths: paths });

    const state = await readCredentialPoolState(paths);
    expect(state.accounts.filter((account) => account.provider === 'grok').map((account) => account.credential)).toEqual([
      { type: 'auth-file', path: accountAuthFile('grok', 'work', paths) },
      { type: 'auth-file', path: accountAuthFile('grok', 'personal', paths) },
    ]);

    const stableRuntimeHome = join(root, 'grok-runtime');
    const sessionFile = join(stableRuntimeHome, 'sessions', 'provider-session.json');
    mkdirSync(join(stableRuntimeHome, 'sessions'), { recursive: true });
    writeFileSync(sessionFile, JSON.stringify({ session: 'same-provider-session' }));

    const activate = async (name: string): Promise<NodeJS.ProcessEnv> => {
      const accountHomePath = accountHome('grok', name, paths);
      const accountAuthPath = accountAuthFile('grok', name, paths);
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
      expect(launchEnvironment.HAPPYHERD_GROK_ACCOUNT_AUTH_FILE).toBe(accountAuthPath);
      expect(JSON.parse(await readFile(accountAuthPath, 'utf8'))).toMatchObject({ account: name });
      expect(JSON.parse(await readFile(sessionFile, 'utf8'))).toEqual({ session: 'same-provider-session' });
      expect((await stat(paths.accountsDir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(paths.accountsDir, 'grok'))).mode & 0o777).toBe(0o700);
      expect((await stat(accountHomePath)).mode & 0o777).toBe(0o700);
      expect((await stat(accountAuthPath)).mode & 0o777).toBe(0o600);
      expect((await stat(stableRuntimeHome)).mode & 0o777).toBe(0o700);
      expect((await stat(join(stableRuntimeHome, 'auth.json'))).mode & 0o777).toBe(0o600);
      return launchEnvironment;
    };

    const workEnvironment = await activate('work');
    expect(JSON.parse(await readFile(join(stableRuntimeHome, 'auth.json'), 'utf8'))).toEqual({ account: 'work' });
    writeFileSync(
      join(stableRuntimeHome, 'auth.json'),
      JSON.stringify({ account: 'work', accessToken: 'refreshed' }),
    );
    chmodSync(join(stableRuntimeHome, 'auth.json'), 0o664);
    await expect(persistActiveGrokCredential(workEnvironment)).resolves.toBe(true);
    expect(JSON.parse(await readFile(accountAuthFile('grok', 'work', paths), 'utf8'))).toEqual({
      account: 'work',
      accessToken: 'refreshed',
    });
    expect((await stat(join(stableRuntimeHome, 'auth.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(accountAuthFile('grok', 'work', paths))).mode & 0o777).toBe(0o600);

    await activate('personal');
    expect(JSON.parse(await readFile(join(stableRuntimeHome, 'auth.json'), 'utf8'))).toEqual({ account: 'personal' });
    await activate('work');
    expect(JSON.parse(await readFile(join(stableRuntimeHome, 'auth.json'), 'utf8'))).toEqual({
      account: 'work',
      accessToken: 'refreshed',
    });
    expect(JSON.parse(await readFile(sessionFile, 'utf8'))).toEqual({ session: 'same-provider-session' });
  });

  it('writes the managed Codex auth file and directory owner-only', async () => {
    await handleConnectCommand(['codex', '--acct', 'work'], { credentialPoolPaths: paths });

    const authFile = accountAuthFile('codex', 'work', paths);
    expect(JSON.parse(await readFile(authFile, 'utf8'))).toMatchObject({
      tokens: { account_id: 'account-id' },
    });
    expect((await stat(paths.accountsDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(paths.accountsDir, 'codex'))).mode & 0o777).toBe(0o700);
    expect((await stat(accountHome('codex', 'work', paths))).mode & 0o777).toBe(0o700);
    expect((await stat(authFile)).mode & 0o777).toBe(0o600);
  });
});
