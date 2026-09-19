import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activateCodexCredential, persistActiveCodexCredential } from './codexAuth';
import {
  credentialAccountEnvironment,
  upsertCredentialAccount,
  type CredentialPoolPaths,
} from './store';

describe('Codex account auth switching', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-codex-account-auth-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('switches only auth.json while retaining the existing runtime home', async () => {
    const accountAuthFile = join(root, 'accounts', 'work', 'auth.json');
    const runtimeHome = join(root, 'runtime');
    await mkdir(join(root, 'accounts', 'work'), { recursive: true });
    await writeFile(accountAuthFile, '{"account":"work"}');

    await activateCodexCredential({
      provider: 'codex',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'work',
      credential: { type: 'auth-file', path: accountAuthFile },
      createdAt: 1,
      updatedAt: 1,
      limitedUntil: null,
      credentialVersion: 1,
    }, runtimeHome);

    expect(await readFile(join(runtimeHome, 'auth.json'), 'utf8')).toBe('{"account":"work"}');
  });

  it('does not write another active account credentials back to an older account', async () => {
    const paths: CredentialPoolPaths = {
      stateFile: join(root, 'credential-pools.json'),
      accountsDir: join(root, 'accounts'),
    };
    const runtimeHome = join(root, 'runtime-overlap');
    const accountA = await upsertCredentialAccount({
      provider: 'codex',
      name: 'work',
      credential: { type: 'auth-file', path: join(root, 'accounts', 'work', 'auth.json') },
    }, { paths, now: 1 });
    const accountB = await upsertCredentialAccount({
      provider: 'codex',
      name: 'personal',
      credential: { type: 'auth-file', path: join(root, 'accounts', 'personal', 'auth.json') },
    }, { paths, now: 2 });
    if (accountA.provider !== 'codex' || accountB.provider !== 'codex') throw new Error('Expected Codex fixtures');
    await mkdir(dirname(accountA.credential.path), { recursive: true });
    await mkdir(dirname(accountB.credential.path), { recursive: true });
    await writeFile(accountA.credential.path, '{"account":"work"}');
    await writeFile(accountB.credential.path, '{"account":"personal"}');

    await activateCodexCredential(accountA, runtimeHome);
    const envA = { CODEX_HOME: runtimeHome, ...credentialAccountEnvironment(accountA) };
    await activateCodexCredential(accountB, runtimeHome);
    const envB = { CODEX_HOME: runtimeHome, ...credentialAccountEnvironment(accountB) };

    await expect(persistActiveCodexCredential(envA, paths)).resolves.toBe(false);
    expect(await readFile(accountA.credential.path, 'utf8')).toBe('{"account":"work"}');

    await writeFile(join(runtimeHome, 'auth.json'), '{"account":"personal-refreshed"}');
    await expect(persistActiveCodexCredential(envB, paths)).resolves.toBe(true);
    expect(await readFile(accountB.credential.path, 'utf8')).toBe('{"account":"personal-refreshed"}');
  });

  it('copies refreshed runtime credentials back to the named account', async () => {
    const accountAuthFile = join(root, 'accounts', 'work', 'auth.json');
    const runtimeHome = join(root, 'runtime');
    const paths: CredentialPoolPaths = {
      stateFile: join(root, 'credential-pools.json'),
      accountsDir: join(root, 'accounts'),
    };
    const account = await upsertCredentialAccount({
      provider: 'codex',
      name: 'work',
      credential: { type: 'auth-file', path: accountAuthFile },
    }, { paths, now: 1 });
    if (account.provider !== 'codex') throw new Error('Expected Codex fixture');
    await mkdir(dirname(accountAuthFile), { recursive: true });
    await writeFile(accountAuthFile, '{"account":"original"}');
    await activateCodexCredential(account, runtimeHome);
    await writeFile(join(runtimeHome, 'auth.json'), '{"account":"refreshed"}');
    await chmod(join(runtimeHome, 'auth.json'), 0o664);

    await expect(persistActiveCodexCredential({
      CODEX_HOME: runtimeHome,
      ...credentialAccountEnvironment(account),
    }, paths)).resolves.toBe(true);

    expect(await readFile(accountAuthFile, 'utf8')).toBe('{"account":"refreshed"}');
    expect((await stat(accountAuthFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'accounts', 'work'))).mode & 0o777).toBe(0o700);
  });
});
