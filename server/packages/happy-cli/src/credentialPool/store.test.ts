import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountHome,
  credentialAccountEnvironment,
  markCredentialAccountLimited,
  readCredentialPoolState,
  removeCredentialAccount,
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
      type: 'all-limited', limitedUntil: 400,
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

    expect(credentialAccountEnvironment(claude)).toEqual({
      HAPPYHERD_PROVIDER_ACCOUNT: 'work',
      HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'claude',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
    });
    expect(credentialAccountEnvironment(codex).HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE).toBe('/tmp/codex-work/auth.json');
    expect(credentialAccountEnvironment(grok)).toEqual({
      HAPPYHERD_PROVIDER_ACCOUNT: 'work',
      HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'grok',
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
    expect(second).toEqual({ type: 'all-limited', limitedUntil: 500 });
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
});
