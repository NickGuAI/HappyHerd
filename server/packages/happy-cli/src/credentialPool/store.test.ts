import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistActiveCodexCredential } from './codexAuth';

import {
  accountHome,
  accountAuthFile,
  commitCredentialLogin,
  credentialAccountEnvironment,
  markCredentialAccountLimited,
  readCredentialPoolState,
  removeCredentialAccount,
  renameCredentialAccount,
  resolveCredentialAccountEnvironment,
  selectCredentialAccount,
  upsertCredentialAccount,
  useCredentialAccount,
  type CredentialPoolPaths,
} from './store';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const concurrentWriterFixture = fileURLToPath(new URL('./fixtures/concurrentUpsert.ts', import.meta.url));

function runConcurrentWriter(
  paths: CredentialPoolPaths,
  name: string,
  barrierFile: string,
): Promise<void> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      [tsxCli, concurrentWriterFixture, paths.stateFile, paths.accountsDir, name, barrierFile],
      {
        cwd: dirname(concurrentWriterFixture),
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', rejectProcess);
    child.once('exit', (code) => {
      if (code === 0) resolveProcess();
      else rejectProcess(new Error(`Concurrent credential writer exited with ${code ?? 'unknown'}: ${stderr}`));
    });
  });
}

describe('credential pool storage and selection', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-credential-pool-'));
    paths = {
      stateFile: join(root, 'credential-pools.json'),
      accountsDir: join(root, 'credential-pools'),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists accounts, current selection, and limited-until state', async () => {
    await upsertCredentialAccount({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token: 'token-work' },
    }, { paths, now: 100 });
    await upsertCredentialAccount({
      provider: 'claude',
      name: 'personal',
      credential: { type: 'oauth-token', token: 'token-personal' },
    }, { paths, now: 101 });

    expect(await selectCredentialAccount('claude', { paths, now: 110 })).toMatchObject({
      type: 'available',
      account: { name: 'work' },
    });
    expect(await markCredentialAccountLimited('claude', 'work', 1_000, { paths, now: 120 })).toMatchObject({
      type: 'next-account',
      account: { name: 'personal' },
    });

    const reloaded = await readCredentialPoolState(paths);
    expect(reloaded.current.claude).toBe('personal');
    expect(reloaded.accounts.find((account) => account.name === 'work')?.limitedUntil).toBe(1_000);
    expect((await stat(paths.stateFile)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.accountsDir)).mode & 0o777).toBe(0o700);
  });

  it('migrates legacy accounts once to durable ids and credential versions', async () => {
    await writeFile(paths.stateFile, JSON.stringify({
      schemaVersion: 1,
      current: { claude: 'work' },
      accounts: [{
        provider: 'claude',
        name: 'work',
        credential: { type: 'oauth-token', token: 'legacy-token' },
        createdAt: 1,
        updatedAt: 1,
        limitedUntil: null,
      }],
    }), { mode: 0o600 });

    const migrated = await readCredentialPoolState(paths);
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      accounts: [{ name: 'work', credentialVersion: 1 }],
    });
    expect(migrated.accounts[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const firstId = migrated.accounts[0].id;
    expect((await readCredentialPoolState(paths)).accounts[0].id).toBe(firstId);
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      accounts: [{ id: firstId, credentialVersion: 1 }],
    });
  });

  it('rotates repeatedly and reports the earliest wait when every account is limited', async () => {
    for (const [index, name] of ['one', 'two', 'three'].entries()) {
      await upsertCredentialAccount({
        provider: 'codex',
        name,
        credential: { type: 'auth-file', path: join(root, name, 'auth.json') },
      }, { paths, now: 10 + index });
    }

    expect(await markCredentialAccountLimited('codex', 'one', 500, { paths, now: 100 })).toMatchObject({
      type: 'next-account', account: { name: 'two' },
    });
    expect(await markCredentialAccountLimited('codex', 'two', 400, { paths, now: 110 })).toMatchObject({
      type: 'next-account', account: { name: 'three' },
    });
    expect(await markCredentialAccountLimited('codex', 'three', 600, { paths, now: 120 })).toEqual({
      type: 'all-limited', limitedUntil: 400, fromAccount: 'three',
    });
    expect(await selectCredentialAccount('codex', { paths, now: 399 })).toEqual({
      type: 'all-limited', limitedUntil: 400,
    });
    expect(await selectCredentialAccount('codex', { paths, now: 400 })).toMatchObject({
      type: 'available', account: { name: 'two' },
    });
    expect((await readCredentialPoolState(paths)).accounts.find((account) => account.name === 'two')?.limitedUntil).toBeNull();
  });

  it('injects only the provider-specific account material', async () => {
    const claude = await upsertCredentialAccount({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token: 'oauth-secret' },
    }, { paths, now: 1 });
    const codex = await upsertCredentialAccount({
      provider: 'codex',
      name: 'work',
      credential: { type: 'auth-file', path: '/tmp/codex-work/auth.json' },
    }, { paths, now: 2 });
    const grok = await upsertCredentialAccount({
      provider: 'grok',
      name: 'work',
      credential: { type: 'auth-file', path: '/tmp/grok-work/auth.json' },
    }, { paths, now: 3 });

    expect(credentialAccountEnvironment(claude)).toMatchObject({
      HAPPYHERD_PROVIDER_ACCOUNT: 'work',
      HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'claude',
      HAPPYHERD_PROVIDER_ACCOUNT_ID: claude.id,
      HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
    });
    expect(credentialAccountEnvironment(codex).HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE).toBe('/tmp/codex-work/auth.json');
    expect(credentialAccountEnvironment(grok)).toMatchObject({
      HAPPYHERD_PROVIDER_ACCOUNT: 'work',
      HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'grok',
      HAPPYHERD_PROVIDER_ACCOUNT_ID: grok.id,
      HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION: '1',
      HAPPYHERD_GROK_ACCOUNT_AUTH_FILE: '/tmp/grok-work/auth.json',
    });
    expect(credentialAccountEnvironment(grok)).not.toHaveProperty('GROK_HOME');
    expect((await resolveCredentialAccountEnvironment('codex', { paths })).env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('serializes parallel limit notices without losing either account update', async () => {
    for (const [index, name] of ['one', 'two'].entries()) {
      await upsertCredentialAccount({
        provider: 'codex',
        name,
        credential: { type: 'auth-file', path: join(root, name, 'auth.json') },
      }, { paths, now: index + 1 });
    }

    const [first, second] = await Promise.all([
      markCredentialAccountLimited('codex', 'one', 500, { paths, now: 100 }),
      markCredentialAccountLimited('codex', 'two', 600, { paths, now: 100 }),
    ]);

    expect(first).toMatchObject({ type: 'next-account', account: { name: 'two' } });
    expect(second).toEqual({ type: 'all-limited', limitedUntil: 500, fromAccount: 'two' });
    const reloaded = await readCredentialPoolState(paths);
    expect(reloaded.current.codex).toBe('two');
    expect(reloaded.accounts.map((account) => [account.name, account.limitedUntil])).toEqual([
      ['one', 500],
      ['two', 600],
    ]);
  });

  it('retains every account written concurrently by separate processes', async () => {
    await upsertCredentialAccount({
      provider: 'claude',
      name: 'existing',
      credential: { type: 'oauth-token', token: 'token-existing' },
    }, { paths, now: 1 });

    const names = Array.from({ length: 10 }, (_, index) => `writer-${index}`);
    const barrierFile = join(root, 'writers-start');
    const writers = names.map((name) => runConcurrentWriter(paths, name, barrierFile));
    await vi.waitFor(
      () => Promise.all(names.map((name) => stat(`${barrierFile}.${name}.ready`))),
      { timeout: 15_000, interval: 20 },
    );
    await writeFile(barrierFile, 'start', { mode: 0o600 });
    await Promise.all(writers);

    const state = await readCredentialPoolState(paths);
    expect(state.accounts.map((account) => account.name).sort()).toEqual(['existing', ...names].sort());
  }, 30_000);

  it('supports explicit use and removes a managed account home', async () => {
    const firstHome = accountHome('grok', 'first', paths);
    const secondHome = accountHome('grok', 'second', paths);
    await mkdir(firstHome, { recursive: true });
    await writeFile(join(firstHome, 'auth.json'), '{}');
    await upsertCredentialAccount({
      provider: 'grok', name: 'first', credential: { type: 'auth-file', path: join(firstHome, 'auth.json') },
    }, { paths, now: 1 });
    await upsertCredentialAccount({
      provider: 'grok', name: 'second', credential: { type: 'auth-file', path: join(secondHome, 'auth.json') },
    }, { paths, now: 2 });

    await useCredentialAccount('grok', 'second', paths);
    expect((await readCredentialPoolState(paths)).current.grok).toBe('second');
    await removeCredentialAccount('grok', 'first', paths);
    await expect(readFile(join(firstHome, 'auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renames account metadata while retaining the credential path used by running sessions', async () => {
    const home = accountHome('codex', 'work', paths);
    const authFile = join(home, 'auth.json');
    await mkdir(home, { recursive: true });
    await writeFile(authFile, '{"secret":"kept"}', { mode: 0o600 });
    const account = await upsertCredentialAccount({
      provider: 'codex', name: 'work', credential: { type: 'auth-file', path: authFile },
    }, { paths, now: 1 });

    const renamed = await renameCredentialAccount('codex', 'work', 'personal', paths);

    expect(renamed).toMatchObject({ provider: 'codex', name: 'personal' });
    expect(renamed.provider === 'codex' && renamed.credential.path).toBe(authFile);
    expect((await readCredentialPoolState(paths)).current.codex).toBe('personal');
    expect(await readFile(authFile, 'utf8')).toContain('kept');

    const runtimeHome = join(root, 'running-codex');
    await mkdir(runtimeHome, { recursive: true });
    await writeFile(join(runtimeHome, 'auth.json'), '{"secret":"refreshed"}', { mode: 0o600 });
    const launchEnvironment = {
      CODEX_HOME: runtimeHome,
      HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: authFile,
      ...credentialAccountEnvironment(account),
    };
    await expect(persistActiveCodexCredential(launchEnvironment, paths)).resolves.toBe(true);

    const stored = (await readCredentialPoolState(paths)).accounts[0];
    expect(stored).toMatchObject({ name: 'personal', credential: { path: authFile } });
    expect(await readFile(authFile, 'utf8')).toContain('refreshed');
    await removeCredentialAccount('codex', 'personal', paths);
    await expect(readFile(authFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let an older running session overwrite a relogin or recreate a removed account', async () => {
    const first = await commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"first"}}'),
    }, { paths, now: 1, target: { type: 'new' } });
    if (first.provider !== 'codex') throw new Error('expected Codex account');
    const runtimeHome = join(root, 'running-codex-versioned');
    await mkdir(runtimeHome, { recursive: true });
    await writeFile(join(runtimeHome, 'auth.json'), '{"tokens":{"access_token":"stale-refresh"}}');
    const oldEnvironment = { CODEX_HOME: runtimeHome, ...credentialAccountEnvironment(first) };

    const relogged = await commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"fresh-login"}}'),
    }, {
      paths,
      now: 2,
      target: { type: 'existing', id: first.id, credentialVersion: first.credentialVersion },
    });
    expect(relogged.credentialVersion).toBe(first.credentialVersion + 1);
    await expect(persistActiveCodexCredential(oldEnvironment, paths)).resolves.toBe(false);
    expect(await readFile(relogged.provider === 'codex' ? relogged.credential.path : '', 'utf8'))
      .toContain('fresh-login');

    await removeCredentialAccount('codex', 'work', paths, {
      id: relogged.id,
      credentialVersion: relogged.credentialVersion,
    });
    await expect(persistActiveCodexCredential({
      CODEX_HOME: runtimeHome,
      ...credentialAccountEnvironment(relogged),
    }, paths)).resolves.toBe(false);
    await expect(stat(relogged.provider === 'codex' ? dirname(relogged.credential.path) : ''))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('atomically rejects an old-revision limit without limiting the relogged credential', async () => {
    const first = await commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"first"}}'),
    }, { paths, now: 1, target: { type: 'new' } });
    const relogged = await commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"fresh"}}'),
    }, {
      paths,
      now: 2,
      target: { type: 'existing', id: first.id, credentialVersion: first.credentialVersion },
    });

    await expect(markCredentialAccountLimited('codex', 'work', 500, {
      paths,
      now: 100,
      accountId: first.id,
      credentialVersion: first.credentialVersion,
    })).resolves.toEqual({ type: 'credential-changed', account: 'work' });
    expect((await readCredentialPoolState(paths)).accounts.find((account) => account.id === relogged.id))
      .toMatchObject({ credentialVersion: relogged.credentialVersion, limitedUntil: null });
  });

  it('does not touch an unrelated home whose folder matches the new nickname', async () => {
    const sourceHome = accountHome('grok', 'source', paths);
    const destinationHome = accountHome('grok', 'destination', paths);
    await mkdir(sourceHome, { recursive: true });
    await mkdir(destinationHome, { recursive: true });
    await writeFile(join(sourceHome, 'auth.json'), '{"key":"source"}');
    await writeFile(join(destinationHome, 'auth.json'), '{"key":"untracked"}');
    await upsertCredentialAccount({
      provider: 'grok',
      name: 'source',
      credential: { type: 'auth-file', path: join(sourceHome, 'auth.json') },
    }, { paths, now: 1 });

    await expect(renameCredentialAccount('grok', 'source', 'destination', paths))
      .resolves.toMatchObject({ name: 'destination' });
    expect((await readCredentialPoolState(paths)).accounts[0]).toMatchObject({
      name: 'destination',
      credential: { path: join(sourceHome, 'auth.json') },
    });
    expect(await readFile(join(sourceHome, 'auth.json'), 'utf8')).toContain('source');
    expect(await readFile(join(destinationHome, 'auth.json'), 'utf8')).toContain('untracked');
  });

  it('does not delete a managed credential home still referenced by another account', async () => {
    const sharedHome = accountHome('grok', 'legacy', paths);
    const sharedFile = join(sharedHome, 'auth.json');
    await mkdir(sharedHome, { recursive: true });
    await writeFile(sharedFile, '{"key":"shared"}');
    for (const name of ['first', 'second']) {
      await upsertCredentialAccount({
        provider: 'grok',
        name,
        credential: { type: 'auth-file', path: sharedFile },
      }, { paths, now: 1 });
    }

    await removeCredentialAccount('grok', 'first', paths);
    expect(await readFile(sharedFile, 'utf8')).toContain('shared');
    await removeCredentialAccount('grok', 'second', paths);
    await expect(readFile(sharedFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps state and credential storage together when managed-home removal cannot start', async () => {
    const home = accountHome('grok', 'protected', paths);
    const authFile = join(home, 'auth.json');
    await mkdir(home, { recursive: true });
    await writeFile(authFile, '{"key":"keep"}', { mode: 0o600 });
    await upsertCredentialAccount({
      provider: 'grok',
      name: 'protected',
      credential: { type: 'auth-file', path: authFile },
    }, { paths, now: 1 });
    const providerDir = dirname(home);
    await chmod(providerDir, 0o500);
    try {
      await expect(removeCredentialAccount('grok', 'protected', paths)).rejects.toBeTruthy();
    } finally {
      await chmod(providerDir, 0o700);
    }
    expect((await readCredentialPoolState(paths)).accounts).toHaveLength(1);
    expect(await readFile(authFile, 'utf8')).toContain('keep');
  });

  it('rejects a provider-scoped rename collision without changing either account', async () => {
    for (const name of ['one', 'two']) {
      await upsertCredentialAccount({
        provider: 'claude', name, credential: { type: 'oauth-token', token: `token-${name}` },
      }, { paths, now: 1 });
    }
    await expect(renameCredentialAccount('claude', 'one', 'two', paths)).rejects.toThrow('already exists');
    expect((await readCredentialPoolState(paths)).accounts.map((account) => account.name)).toEqual(['one', 'two']);
  });

  it('commits a replacement auth artifact and current selection together', async () => {
    const home = accountHome('codex', 'work', paths);
    const authFile = join(home, 'auth.json');
    await mkdir(home, { recursive: true });
    await writeFile(authFile, '{"tokens":{"access_token":"old"}}', { mode: 0o600 });
    await upsertCredentialAccount({
      provider: 'codex',
      name: 'work',
      credential: { type: 'auth-file', path: authFile },
    }, { paths, now: 1 });

    const committed = await commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"new"}}'),
    }, { paths, now: 2 });

    expect(committed).toMatchObject({ provider: 'codex', name: 'work', updatedAt: 2 });
    expect(await readFile(authFile, 'utf8')).toContain('"new"');
    expect((await readCredentialPoolState(paths)).current.codex).toBe('work');
  });

  it('restores an existing auth artifact when state persistence fails', async () => {
    const initial = await commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"old"}}'),
    }, { paths, now: 1 });
    if (initial.provider !== 'codex') throw new Error('expected Codex account');
    const authFile = initial.credential.path;

    await expect(commitCredentialLogin({
      provider: 'codex',
      name: 'work',
      authFile: Buffer.from('{"tokens":{"access_token":"new"}}'),
    }, {
      paths,
      now: 2,
      writeState: async () => { throw new Error('state write failed'); },
    })).rejects.toThrow('state write failed');

    expect(await readFile(authFile, 'utf8')).toContain('"old"');
    expect((await readCredentialPoolState(paths)).accounts[0]?.updatedAt).toBe(1);
  });

  it('removes a newly created auth home after state failure so login can retry', async () => {
    let failedPath = '';
    await expect(commitCredentialLogin({
      provider: 'grok',
      name: 'retryable',
      authFile: Buffer.from('{"api_key":"first"}'),
    }, {
      paths,
      now: 1,
      writeCredential: async (path, bytes) => {
        failedPath = path;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        throw new Error('credential write failed');
      },
    })).rejects.toThrow('credential write failed');

    expect(failedPath).not.toBe('');
    await expect(stat(dirname(failedPath))).rejects.toMatchObject({ code: 'ENOENT' });
    const committed = await commitCredentialLogin({
      provider: 'grok',
      name: 'retryable',
      authFile: Buffer.from('{"api_key":"second"}'),
    }, { paths, now: 2 });

    expect(committed).toMatchObject({ provider: 'grok', name: 'retryable' });
    expect(committed.provider).toBe('grok');
    expect(await readFile(committed.provider === 'grok' ? committed.credential.path : '', 'utf8'))
      .toContain('"second"');
    expect((await readdir(join(paths.accountsDir, 'grok'))).length).toBe(1);
  });

  it('does not change the selected account when another account logs in again', async () => {
    for (const name of ['default', 'secondary']) {
      await commitCredentialLogin({
        provider: 'claude',
        name,
        token: `token-${name}`,
      }, { paths, now: 1 });
    }
    expect((await readCredentialPoolState(paths)).current.claude).toBe('default');

    await commitCredentialLogin({
      provider: 'claude',
      name: 'secondary',
      token: 'refreshed-secondary',
    }, { paths, now: 2 });

    const state = await readCredentialPoolState(paths);
    expect(state.current.claude).toBe('default');
    const secondary = state.accounts.find((account) => account.name === 'secondary');
    expect(secondary?.provider === 'claude' && secondary.credential.token).toBe('refreshed-secondary');
  });

  it('never deletes auth files outside the exact provider account home', async () => {
    const nestedHome = join(paths.accountsDir, 'grok', 'outer', 'nested');
    const wrongNameHome = join(paths.accountsDir, 'grok', 'wrong-name');
    const nestedFile = join(nestedHome, 'auth.json');
    const wrongNameFile = join(wrongNameHome, 'credentials.json');
    await mkdir(nestedHome, { recursive: true });
    await mkdir(wrongNameHome, { recursive: true });
    await writeFile(nestedFile, '{"key":"keep"}');
    await writeFile(wrongNameFile, '{"key":"keep"}');

    await upsertCredentialAccount({
      provider: 'grok', name: 'nested', credential: { type: 'auth-file', path: nestedFile },
    }, { paths, now: 1 });
    await removeCredentialAccount('grok', 'nested', paths);
    expect(await readFile(nestedFile, 'utf8')).toContain('keep');

    await upsertCredentialAccount({
      provider: 'grok', name: 'wrong', credential: { type: 'auth-file', path: wrongNameFile },
    }, { paths, now: 2 });
    await removeCredentialAccount('grok', 'wrong', paths);
    expect(await readFile(wrongNameFile, 'utf8')).toContain('keep');
  });
});
