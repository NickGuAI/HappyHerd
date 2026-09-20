import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activateGrokCredential, persistActiveGrokCredential } from './grokAuth';
import {
  commitCredentialLogin,
  credentialAccountEnvironment,
  removeCredentialAccount,
  writeCredentialBytes,
  type CredentialPoolPaths,
} from './store';

describe('Grok native auth ownership', () => {
  let root: string;
  let runtimeHome: string;
  let paths: CredentialPoolPaths;
  let historyFile: string;

  const bytes = (account: string): Buffer => Buffer.from(JSON.stringify({
    account,
    accessToken: `synthetic-${account}`,
  }));

  const createAccount = async (name: string, credential = name) => {
    const account = await commitCredentialLogin({
      provider: 'grok',
      name,
      authFile: bytes(credential),
    }, { paths });
    if (account.provider !== 'grok') throw new Error('Expected a Grok fixture account');
    return account;
  };

  const environment = (
    account: Awaited<ReturnType<typeof createAccount>>,
    runtimeAuthFile: string,
  ): NodeJS.ProcessEnv => ({
    GROK_HOME: runtimeHome,
    GROK_AUTH_PATH: runtimeAuthFile,
    ...credentialAccountEnvironment(account),
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happyherd-grok-native-auth-'));
    runtimeHome = join(root, 'shared-grok-home');
    paths = {
      stateFile: join(root, 'credential-pools.json'),
      accountsDir: join(root, 'accounts'),
    };
    historyFile = join(runtimeHome, 'sessions', 'native-history');
    await mkdir(dirname(historyFile), { recursive: true });
    await writeFile(historyFile, 'same-grok-acp-session-history');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('isolates overlapping account writers while retaining one shared Grok history home', async () => {
    const accountA = await createAccount('a');
    const accountB = await createAccount('b');
    const authA = await activateGrokCredential(accountA, runtimeHome, paths);
    const authB = await activateGrokCredential(accountB, runtimeHome, paths);

    expect(authA).not.toBe(authB);
    expect(resolve(authA)).not.toBe(resolve(accountA.credential.path));
    expect(resolve(authB)).not.toBe(resolve(accountB.credential.path));
    await writeCredentialBytes(authA, bytes('a-refreshed-after-b-started'));
    await writeCredentialBytes(authB, bytes('b-refreshed'));

    const environmentB = environment(accountB, authB);
    expect(environmentB.HAPPYHERD_GROK_ACCOUNT_AUTH_FILE).toBe(accountB.credential.path);
    await expect(persistActiveGrokCredential({
      ...environmentB,
      GROK_AUTH_PATH: authA,
    }, paths)).resolves.toBe(false);
    await expect(persistActiveGrokCredential(environmentB, paths)).resolves.toBe(true);
    expect(await readFile(accountB.credential.path)).toEqual(bytes('b-refreshed'));
    expect(await readFile(accountA.credential.path)).toEqual(bytes('a'));

    await expect(persistActiveGrokCredential(environment(accountA, authA), paths)).resolves.toBe(true);
    expect(await readFile(accountA.credential.path)).toEqual(bytes('a-refreshed-after-b-started'));
    expect(await readFile(historyFile, 'utf8')).toBe('same-grok-acp-session-history');
    await expect(readFile(join(runtimeHome, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains native refresh bytes across a second activation of the same account version', async () => {
    const account = await createAccount('work');
    const runtimeAuthFile = await activateGrokCredential(account, runtimeHome, paths);
    await writeFile(runtimeAuthFile, bytes('native-refresh'), { mode: 0o664 });

    await expect(activateGrokCredential(account, runtimeHome, paths)).resolves.toBe(runtimeAuthFile);
    expect(await readFile(runtimeAuthFile)).toEqual(bytes('native-refresh'));
    expect((await stat(runtimeAuthFile)).mode & 0o777).toBe(0o600);
    const privateDirectories = [
      dirname(runtimeAuthFile),
      dirname(dirname(runtimeAuthFile)),
      dirname(dirname(dirname(runtimeAuthFile))),
      dirname(account.credential.path),
    ];
    for (const directory of privateDirectories) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
    await expect(persistActiveGrokCredential(environment(account, runtimeAuthFile), paths)).resolves.toBe(true);
    expect(await readFile(account.credential.path)).toEqual(bytes('native-refresh'));
    expect((await stat(account.credential.path)).mode & 0o777).toBe(0o600);
    expect(await readFile(historyFile, 'utf8')).toBe('same-grok-acp-session-history');
  });

  it('rejects writeback from a previous credential version after relogin', async () => {
    const first = await createAccount('work', 'v1');
    const firstRuntimeAuth = await activateGrokCredential(first, runtimeHome, paths);
    await writeCredentialBytes(firstRuntimeAuth, bytes('v1-late-refresh'));

    const replacement = await createAccount('work', 'v2');
    expect(replacement.id).toBe(first.id);
    expect(replacement.credentialVersion).toBe(first.credentialVersion + 1);
    await expect(activateGrokCredential(first, runtimeHome, paths)).rejects.toThrow(
      'changed before activation',
    );
    const replacementRuntimeAuth = await activateGrokCredential(replacement, runtimeHome, paths);
    expect(replacementRuntimeAuth).not.toBe(firstRuntimeAuth);

    await expect(persistActiveGrokCredential(environment(first, firstRuntimeAuth), paths)).resolves.toBe(false);
    expect(await readFile(replacement.credential.path)).toEqual(bytes('v2'));
    await writeCredentialBytes(replacementRuntimeAuth, bytes('v2-native-refresh'));
    await expect(persistActiveGrokCredential(
      environment(replacement, replacementRuntimeAuth),
      paths,
    )).resolves.toBe(true);
    expect(await readFile(replacement.credential.path)).toEqual(bytes('v2-native-refresh'));
  });

  it('rejects a removed account even if its old native process recreates the owned path', async () => {
    const account = await createAccount('removed');
    const runtimeAuthFile = await activateGrokCredential(account, runtimeHome, paths);
    const env = environment(account, runtimeAuthFile);
    await removeCredentialAccount('grok', account.name, paths, {
      id: account.id,
      credentialVersion: account.credentialVersion,
    });
    await expect(activateGrokCredential(account, runtimeHome, paths)).rejects.toThrow(
      'changed before activation',
    );
    await writeCredentialBytes(runtimeAuthFile, bytes('removed-late-refresh'));

    await expect(persistActiveGrokCredential(env, paths)).resolves.toBe(false);
  });

  it('rejects the stable registered credential path as native writeback provenance', async () => {
    const account = await createAccount('work');
    await activateGrokCredential(account, runtimeHome, paths);
    const original = await readFile(account.credential.path);

    await expect(persistActiveGrokCredential({
      ...environment(account, account.credential.path),
      HAPPYHERD_GROK_ACCOUNT_AUTH_FILE: account.credential.path,
    }, paths)).resolves.toBe(false);
    expect(await readFile(account.credential.path)).toEqual(original);
  });
});
