import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activateRuntimeAuthCredential, runtimeAuthOwnerPath } from './runtimeAuthOwnership';
import { codexRuntimeCredentialOwnedByProcess, persistActiveCodexCredential } from './codexAuth';
import { persistActiveGrokCredential } from './grokAuth';
import { commitCredentialLogin, credentialAccountEnvironment, type CredentialPoolPaths } from './store';

describe.each(['codex', 'grok'] as const)('%s runtime auth ownership', (provider) => {
  let root: string;
  let home: string;
  let paths: CredentialPoolPaths;
  const persist = provider === 'codex' ? persistActiveCodexCredential : persistActiveGrokCredential;
  const bytes = (name: string) => Buffer.from(JSON.stringify({ account: name, token: `synthetic-${name}` }));
  const createAccount = async (name: string) => {
    const account = await commitCredentialLogin({ provider, name, authFile: bytes(name) }, { paths });
    if (account.provider === 'claude') throw new Error('Expected an auth-file fixture');
    return account;
  };
  const environment = (account: Awaited<ReturnType<typeof createAccount>>) => ({
    [provider === 'codex' ? 'CODEX_HOME' : 'GROK_HOME']: home,
    ...credentialAccountEnvironment(account),
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happyherd-runtime-owner-'));
    home = join(root, 'native-home');
    paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
    await mkdir(join(home, 'sessions'), { recursive: true });
    await writeFile(join(home, 'sessions', 'native-history'), 'same-native-session-and-history');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rejects stale writeback while allowing the current account to refresh without moving history', async () => {
    const a = await createAccount('a');
    const b = await createAccount('b');
    await activateRuntimeAuthCredential(a, home);
    await activateRuntimeAuthCredential(b, home);
    await expect(persist(environment(a), paths)).resolves.toBe(false);
    expect(await readFile(a.credential.path)).toEqual(bytes('a'));
    await writeFile(join(home, 'auth.json'), bytes('b-refreshed'));
    await expect(persist(environment(b), paths)).resolves.toBe(true);
    expect(await readFile(b.credential.path)).toEqual(bytes('b-refreshed'));
    expect(await readFile(join(home, 'sessions', 'native-history'), 'utf8')).toBe('same-native-session-and-history');
    expect((await stat(b.credential.path)).mode & 0o777).toBe(0o600);
    expect((await stat(runtimeAuthOwnerPath(home))).mode & 0o777).toBe(0o600);
  });

  it('does not claim the old auth when a new activation source is missing', async () => {
    const a = await createAccount('a');
    const b = await createAccount('b');
    await activateRuntimeAuthCredential(a, home);
    const owner = await readFile(runtimeAuthOwnerPath(home));
    await expect(activateRuntimeAuthCredential({
      ...b, credential: { type: 'auth-file', path: join(root, 'missing-source') },
    }, home)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(runtimeAuthOwnerPath(home))).toEqual(owner);
    expect(await readFile(join(home, 'auth.json'))).toEqual(bytes('a'));
    await expect(persist(environment(b), paths)).resolves.toBe(false);
    await expect(persist(environment(a), paths)).resolves.toBe(true);
  });

  it('serializes overlapping activation and stale writeback in the shared runtime slot', async () => {
    const a = await createAccount('a');
    const b = await createAccount('b');
    await activateRuntimeAuthCredential(a, home);
    const activation = activateRuntimeAuthCredential(b, home);
    const staleWriteback = persist(environment(a), paths);
    await activation;
    await expect(staleWriteback).resolves.toBe(false);
    expect(await readFile(join(home, 'auth.json'))).toEqual(bytes('b'));
    expect(await readFile(a.credential.path)).toEqual(bytes('a'));
    const owner = JSON.parse(await readFile(runtimeAuthOwnerPath(home), 'utf8'));
    expect(owner).toEqual({ provider, accountId: b.id, credentialVersion: b.credentialVersion });
    await Promise.all([activateRuntimeAuthCredential(a, home), activateRuntimeAuthCredential(b, home)]);
    expect(await readFile(join(home, 'auth.json'))).toEqual(bytes('b'));
    await expect(persist(environment(a), paths)).resolves.toBe(false);
  });

  it('does not overwrite a relogged registration from the old credential version', async () => {
    const a = await createAccount('a');
    await activateRuntimeAuthCredential(a, home);
    const replacement = await createAccount('a');
    expect(replacement.id).toBe(a.id);
    expect(replacement.credentialVersion).toBe(a.credentialVersion + 1);
    await writeFile(join(home, 'auth.json'), bytes('old-process-refresh'));
    await expect(persist(environment(a), paths)).resolves.toBe(false);
    expect(await readFile(replacement.credential.path)).toEqual(bytes('a'));
    await activateRuntimeAuthCredential(replacement, home);
    await expect(persist(environment(replacement), paths)).resolves.toBe(true);
  });

  it('does not accept absent or malformed ownership evidence for a managed process', async () => {
    const a = await createAccount('a');
    await expect(persist(environment(a), paths)).resolves.toBe(false);
    await writeFile(runtimeAuthOwnerPath(home), 'null');
    await expect(persist(environment(a), paths)).resolves.toBe(false);
    if (provider === 'codex') {
      await expect(codexRuntimeCredentialOwnedByProcess(environment(a))).resolves.toBe(false);
      await expect(codexRuntimeCredentialOwnedByProcess({})).resolves.toBe(true);
    }
  });
});
