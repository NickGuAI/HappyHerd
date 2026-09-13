import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activateCredentialAccount } from './activate';
import { accountAuthFile, upsertCredentialAccount, type CredentialPoolPaths } from './store';
import type { CredentialProvider } from './types';

describe('managed credential activation', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-credential-activate-'));
    paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function addAccount(provider: CredentialProvider): Promise<void> {
    if (provider === 'claude') {
      await upsertCredentialAccount({
        provider,
        name: 'managed',
        credential: { type: 'oauth-token', token: 'managed-token' },
      }, { paths, now: 1 });
      return;
    }
    const authFile = accountAuthFile(provider, 'managed', paths);
    await mkdir(join(paths.accountsDir, provider, 'managed'), { recursive: true });
    await writeFile(authFile, '{"tokens":{"access_token":"managed"}}', { mode: 0o600 });
    await upsertCredentialAccount({
      provider,
      name: 'managed',
      credential: { type: 'auth-file', path: authFile },
    }, { paths, now: 1 });
  }

  it.each([
    ['claude', ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], 'OPENAI_API_KEY'],
    ['codex', ['OPENAI_API_KEY', 'OPENAI_ACCESS_TOKEN', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'], 'XAI_API_KEY'],
    ['grok', ['XAI_API_KEY', 'GROK_API_KEY'], 'OPENAI_API_KEY'],
  ] as const)('clears direct %s auth only when a managed account is selected', async (provider, directKeys, unrelatedKey) => {
    await addAccount(provider);
    const env: NodeJS.ProcessEnv = {
      HOME: root,
      CODEX_HOME: join(root, 'codex-runtime'),
      GROK_HOME: join(root, 'grok-runtime'),
      [unrelatedKey]: 'keep-unrelated',
    };
    for (const key of directKeys) env[key] = 'ambient-secret';

    await expect(activateCredentialAccount(provider, { paths, env })).resolves.toMatchObject({ type: 'available' });
    for (const key of directKeys) expect(env[key]).toBeUndefined();
    expect(env[unrelatedKey]).toBe('keep-unrelated');
    if (provider === 'claude') expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('managed-token');
    if (provider === 'codex') expect(await readFile(join(env.CODEX_HOME!, 'auth.json'), 'utf8')).toContain('managed');
    if (provider === 'grok') expect(await readFile(join(env.GROK_HOME!, 'auth.json'), 'utf8')).toContain('managed');
  });

  it('preserves ambient provider auth when no managed account exists', async () => {
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'ambient-secret' };
    await expect(activateCredentialAccount('claude', { paths, env })).resolves.toEqual({ type: 'unconfigured' });
    expect(env.ANTHROPIC_API_KEY).toBe('ambient-secret');
  });
});
