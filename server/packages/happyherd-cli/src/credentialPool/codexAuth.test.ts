import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadManagedCodexAuth,
  refreshManagedCodexAuth,
} from './codexAuth';
import {
  credentialAccountEnvironment,
  serializeCredentialPoolState,
  upsertCredentialAccount,
  type CredentialPoolPaths,
} from './store';

describe('managed Codex app-server authentication', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happyherd-codex-ephemeral-auth-'));
    paths = {
      stateFile: join(root, 'credential-pools.json'),
      accountsDir: join(root, 'accounts'),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function createAccount(auth: string): Promise<Extract<Awaited<ReturnType<typeof upsertCredentialAccount>>, { provider: 'codex' }>> {
    const accountAuthFile = join(paths.accountsDir, 'codex', 'work', 'auth.json');
    await mkdir(join(paths.accountsDir, 'codex', 'work'), { recursive: true });
    await writeFile(accountAuthFile, auth, { mode: 0o600 });
    const account = await upsertCredentialAccount({
      provider: 'codex',
      name: 'work',
      credential: { type: 'auth-file', path: accountAuthFile },
    }, { paths, now: 1 });
    if (account.provider !== 'codex') throw new Error('Expected Codex fixture');
    return account;
  }

  function envFor(account: Extract<Awaited<ReturnType<typeof upsertCredentialAccount>>, { provider: 'codex' }>): NodeJS.ProcessEnv {
    return {
      CODEX_HOME: join(root, 'native-home'),
      ...credentialAccountEnvironment(account),
    };
  }

  it('loads API-key and ChatGPT credentials by stable account registration', async () => {
    const apiAccount = await createAccount(JSON.stringify({ OPENAI_API_KEY: 'sk-fixture-key' }));
    const apiAuth = await loadManagedCodexAuth(envFor(apiAccount), paths);
    expect(apiAuth).toMatchObject({
      kind: 'api-key',
      accountId: apiAccount.id,
      credentialVersion: apiAccount.credentialVersion,
      apiKey: 'sk-fixture-key',
    });

    const chatAccount = await createAccount(JSON.stringify({
      tokens: {
        access_token: 'access-fixture',
        refresh_token: 'refresh-fixture',
        account_id: 'chatgpt-account-fixture',
        chatgpt_plan_type: 'plus',
      },
    }));
    const chatAuth = await loadManagedCodexAuth(envFor(chatAccount), paths);
    expect(chatAuth).toMatchObject({
      kind: 'chatgpt',
      accessToken: 'access-fixture',
      refreshToken: 'refresh-fixture',
      chatgptAccountId: 'chatgpt-account-fixture',
      chatgptPlanType: 'plus',
    });
  });

  it('rejects a stale account version and removed account without reading a new file', async () => {
    const account = await createAccount(JSON.stringify({ OPENAI_API_KEY: 'sk-fixture-key' }));
    const environment = envFor(account);
    await expect(loadManagedCodexAuth({
      ...environment,
      HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION: String(account.credentialVersion + 1),
    }, paths)).rejects.toThrow('no longer active');

    await rm(account.credential.path, { force: true });
    await expect(loadManagedCodexAuth(environment, paths)).rejects.toThrow('invalid');
  });

  it('uses a newer stored token after waiting for another process refresh', async () => {
    const account = await createAccount(JSON.stringify({
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    }));
    const auth = await loadManagedCodexAuth(envFor(account), paths);
    if (!auth || auth.kind !== 'chatgpt') throw new Error('Expected ChatGPT auth');
    await writeFile(account.credential.path, JSON.stringify({
      tokens: {
        access_token: 'newer-access',
        refresh_token: 'newer-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    }));
    const fetcher = vi.fn();
    const refreshed = await refreshManagedCodexAuth(auth, { fetcher }, paths, envFor(account));
    expect(refreshed).toMatchObject({ kind: 'chatgpt', accessToken: 'newer-access', refreshToken: 'newer-refresh' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses a newer stored refresh token even when the access token is unchanged', async () => {
    const account = await createAccount(JSON.stringify({
      tokens: {
        access_token: 'same-access',
        refresh_token: 'old-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    }));
    const auth = await loadManagedCodexAuth(envFor(account), paths);
    if (!auth || auth.kind !== 'chatgpt') throw new Error('Expected ChatGPT auth');
    await writeFile(account.credential.path, JSON.stringify({
      tokens: {
        access_token: 'same-access',
        refresh_token: 'newer-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    }));

    const fetcher = vi.fn(async (_url: string | URL | Request, init: RequestInit = {}) => {
      expect(String(init.body)).toContain('refresh_token=newer-refresh');
      expect(String(init.body)).not.toContain('refresh_token=old-refresh');
      return {
        ok: true,
        json: async () => ({ access_token: 'refreshed-access', account_id: 'chatgpt-account-fixture' }),
      } as Response;
    });
    const refreshed = await refreshManagedCodexAuth(auth, { fetcher }, paths, envFor(account));
    expect(refreshed).toMatchObject({
      kind: 'chatgpt',
      accessToken: 'refreshed-access',
      refreshToken: 'newer-refresh',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes and persists ChatGPT tokens while retaining the prior refresh token when omitted', async () => {
    const account = await createAccount(JSON.stringify({
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    }));
    const environment = {
      ...envFor(account),
      CODEX_REFRESH_TOKEN_URL_OVERRIDE: 'https://fixture.invalid/oauth/token',
      CODEX_APP_SERVER_LOGIN_CLIENT_ID: 'fixture-client-id',
    };
    const auth = await loadManagedCodexAuth(environment, paths);
    if (!auth || auth.kind !== 'chatgpt') throw new Error('Expected ChatGPT auth');
    const fetcher = vi.fn(async (_url: string | URL | Request, init: RequestInit = {}) => {
      expect(init.method).toBe('POST');
      expect(String(init.body)).toContain('grant_type=refresh_token');
      expect(String(init.body)).toContain('client_id=fixture-client-id');
      expect(String(init.body)).toContain('refresh_token=old-refresh');
      return {
        ok: true,
        json: async () => ({ access_token: 'refreshed-access', account_id: 'chatgpt-account-fixture' }),
      } as Response;
    });
    const refreshed = await refreshManagedCodexAuth(auth, { fetcher }, paths, environment);
    expect(refreshed).toMatchObject({ kind: 'chatgpt', accessToken: 'refreshed-access', refreshToken: 'old-refresh' });
    expect(JSON.parse(await readFile(account.credential.path, 'utf8'))).toMatchObject({
      tokens: {
        access_token: 'refreshed-access',
        refresh_token: 'old-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    });
  });

  it('expires while queued and performs no later fetch or credential write', async () => {
    const account = await createAccount(JSON.stringify({
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        account_id: 'chatgpt-account-fixture',
      },
    }));
    const auth = await loadManagedCodexAuth(envFor(account), paths);
    if (!auth || auth.kind !== 'chatgpt') throw new Error('Expected ChatGPT auth');

    let release!: () => void;
    const hold = serializeCredentialPoolState(paths, () => new Promise<void>((resolve) => {
      release = resolve;
    }));
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));

    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'late-access', account_id: 'chatgpt-account-fixture' }),
    }) as Response);
    const original = await readFile(account.credential.path, 'utf8');
    await expect(refreshManagedCodexAuth(auth, { fetcher, timeoutMs: 25 }, paths, envFor(account)))
      .rejects.toThrow('timed out');

    release();
    await hold;
    // Let the queued callback run after the lock is released. Its deadline
    // checks must prevent both the refresh request and credential write.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(account.credential.path, 'utf8')).toBe(original);
  });

  it('rejects refresh for API keys and never exposes token data in errors', async () => {
    const account = await createAccount(JSON.stringify({ OPENAI_API_KEY: 'sk-secret-fixture' }));
    const auth = await loadManagedCodexAuth(envFor(account), paths);
    if (!auth || auth.kind !== 'api-key') throw new Error('Expected API-key auth');
    await expect(refreshManagedCodexAuth(auth, {}, paths, envFor(account)))
      .rejects.toThrow('does not support token refresh');
    await expect(loadManagedCodexAuth({
      ...envFor(account),
      HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION: 'not-a-version',
    }, paths)).rejects.toThrow('invalid');
    try {
      await loadManagedCodexAuth({
        ...envFor(account),
        HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION: 'not-a-version',
      }, paths);
    } catch (error) {
      expect(String(error)).not.toContain('sk-secret-fixture');
    }
  });

  it('leaves unmanaged native launches opt-out of the managed auth path', async () => {
    await expect(loadManagedCodexAuth({ CODEX_HOME: join(root, 'native-home') }, paths)).resolves.toBeNull();
  });
});
