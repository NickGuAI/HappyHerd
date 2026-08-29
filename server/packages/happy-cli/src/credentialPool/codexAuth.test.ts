import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activateCodexCredential, persistActiveCodexCredential } from './codexAuth';

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
      name: 'work',
      credential: { type: 'auth-file', path: accountAuthFile },
      createdAt: 1,
      updatedAt: 1,
      limitedUntil: null,
    }, runtimeHome);

    expect(await readFile(join(runtimeHome, 'auth.json'), 'utf8')).toBe('{"account":"work"}');
  });

  it('copies refreshed runtime credentials back to the named account', async () => {
    const accountAuthFile = join(root, 'accounts', 'work', 'auth.json');
    const runtimeHome = join(root, 'runtime');
    await mkdir(runtimeHome, { recursive: true });
    await writeFile(join(runtimeHome, 'auth.json'), '{"account":"refreshed"}');
    await chmod(join(runtimeHome, 'auth.json'), 0o664);

    await expect(persistActiveCodexCredential({
      CODEX_HOME: runtimeHome,
      HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: accountAuthFile,
    })).resolves.toBe(true);

    expect(await readFile(accountAuthFile, 'utf8')).toBe('{"account":"refreshed"}');
    expect((await stat(accountAuthFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'accounts', 'work'))).mode & 0o777).toBe(0o700);
  });
});
