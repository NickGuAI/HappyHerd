import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  defaultCredentialPoolPaths,
  persistRegisteredCredentialFile,
  writeCredentialBytes,
  type CredentialPoolPaths,
} from './store';

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_REFRESH_TIMEOUT_MS = 4_000;
const CODEX_REFRESH_CALLBACK_TIMEOUT_MS = 9_000;
const DEFAULT_CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token';

const MANAGED_AUTH_REMOVED_ERROR = 'Managed Codex credential is no longer active; sign in again.';
const MANAGED_AUTH_INVALID_ERROR = 'Managed Codex credential is invalid.';

type JsonRecord = Record<string, unknown>;

export type ManagedCodexAuthRegistration = {
  accountId: string;
  credentialVersion: number;
  sourcePath: string;
};

export type ManagedCodexAuth = ManagedCodexAuthRegistration & ({
  kind: 'api-key';
  apiKey: string;
} | {
  kind: 'chatgpt';
  accessToken: string;
  refreshToken?: string;
  chatgptAccountId: string;
  chatgptPlanType?: string;
  rawRecord: JsonRecord;
});

export type ManagedCodexAuthRefreshContext = {
  previousAccountId?: string | null;
  fetcher?: typeof fetch;
  /** Total native callback budget, including the credential-pool queue and file lock. */
  timeoutMs?: number;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function objectValue(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function decodeJwtPayload(value: unknown): JsonRecord | undefined {
  const token = nonEmptyString(value);
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return objectValue(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

function authClaim(record: JsonRecord | undefined): JsonRecord | undefined {
  return objectValue(record?.['https://api.openai.com/auth']);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = nonEmptyString(value);
    if (result) return result;
  }
  return undefined;
}

function parseManagedCodexAuthRecord(
  record: JsonRecord,
  registration: ManagedCodexAuthRegistration,
): ManagedCodexAuth {
  const apiKey = nonEmptyString(record.OPENAI_API_KEY);
  if (apiKey) {
    return { ...registration, kind: 'api-key', apiKey };
  }

  const tokens = objectValue(record.tokens) ?? record;
  const accessToken = firstString(tokens.access_token, record.access_token);
  const refreshToken = firstString(tokens.refresh_token, record.refresh_token);
  const idToken = firstString(tokens.id_token, record.id_token);
  const idClaims = decodeJwtPayload(idToken);
  const accessClaims = decodeJwtPayload(accessToken);
  const idAuthClaim = authClaim(idClaims);
  const accessAuthClaim = authClaim(accessClaims);
  const chatgptAccountId = firstString(
    tokens.account_id,
    tokens.chatgpt_account_id,
    record.account_id,
    record.chatgpt_account_id,
    idClaims?.chatgpt_account_id,
    idClaims?.account_id,
    idAuthClaim?.chatgpt_account_id,
    idAuthClaim?.account_id,
    accessClaims?.chatgpt_account_id,
    accessClaims?.account_id,
    accessAuthClaim?.chatgpt_account_id,
    accessAuthClaim?.account_id,
  );
  const chatgptPlanType = firstString(
    tokens.chatgpt_plan_type,
    tokens.plan_type,
    record.chatgpt_plan_type,
    record.plan_type,
    idClaims?.chatgpt_plan_type,
    idAuthClaim?.chatgpt_plan_type,
    accessClaims?.chatgpt_plan_type,
    accessAuthClaim?.chatgpt_plan_type,
  );

  if (!accessToken || !chatgptAccountId) {
    throw new Error(MANAGED_AUTH_INVALID_ERROR);
  }

  return {
    ...registration,
    kind: 'chatgpt',
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    chatgptAccountId,
    ...(chatgptPlanType ? { chatgptPlanType } : {}),
    rawRecord: record,
  };
}

function managedRegistrationFromEnvironment(env: NodeJS.ProcessEnv): ManagedCodexAuthRegistration | null {
  const sourcePath = env.HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE?.trim();
  if (!sourcePath) return null;
  if (env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE !== 'codex') {
    throw new Error(MANAGED_AUTH_INVALID_ERROR);
  }
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) {
    throw new Error(MANAGED_AUTH_INVALID_ERROR);
  }
  return { accountId, credentialVersion, sourcePath: resolve(sourcePath) };
}

async function readRegisteredCodexAuth(
  registration: ManagedCodexAuthRegistration,
  paths: CredentialPoolPaths,
): Promise<ManagedCodexAuth> {
  let result: ManagedCodexAuth | undefined;
  const persisted = await persistRegisteredCredentialFile(
    'codex',
    { accountId: registration.accountId, credentialVersion: registration.credentialVersion },
    async (registeredPath) => {
      if (resolve(registeredPath) !== registration.sourcePath) throw new Error(MANAGED_AUTH_INVALID_ERROR);
      let record: unknown;
      try {
        record = JSON.parse(await readFile(registeredPath, 'utf8'));
      } catch {
        throw new Error(MANAGED_AUTH_INVALID_ERROR);
      }
      const parsed = objectValue(record);
      if (!parsed) throw new Error(MANAGED_AUTH_INVALID_ERROR);
      result = parseManagedCodexAuthRecord(parsed, registration);
    },
    paths,
  );
  if (!persisted) throw new Error(MANAGED_AUTH_REMOVED_ERROR);
  if (!result) throw new Error(MANAGED_AUTH_INVALID_ERROR);
  return result;
}

export async function loadManagedCodexAuth(
  env: NodeJS.ProcessEnv = process.env,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<ManagedCodexAuth | null> {
  const registration = managedRegistrationFromEnvironment(env);
  if (!registration) return null;
  return readRegisteredCodexAuth(registration, paths);
}

function refreshUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_REFRESH_TOKEN_URL_OVERRIDE?.trim();
  return configured || DEFAULT_CODEX_REFRESH_URL;
}

function refreshClientId(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_APP_SERVER_LOGIN_CLIENT_ID?.trim();
  return configured || CODEX_OAUTH_CLIENT_ID;
}

function refreshFailure(): Error {
  return new Error('Managed Codex authentication refresh failed.');
}

function refreshTimeout(): Error {
  return new Error('Managed Codex authentication refresh timed out.');
}

function throwIfRefreshExpired(deadline: number): void {
  if (Date.now() >= deadline) throw refreshTimeout();
}

async function refreshTokens(
  auth: ManagedCodexAuth,
  context: ManagedCodexAuthRefreshContext,
  env: NodeJS.ProcessEnv,
  deadline: number,
): Promise<{ accessToken: string; refreshToken?: string; accountId: string; idToken?: string }> {
  if (auth.kind !== 'chatgpt' || !auth.refreshToken) throw refreshFailure();
  throwIfRefreshExpired(deadline);
  const controller = new AbortController();
  const remainingMs = Math.max(1, deadline - Date.now());
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(CODEX_REFRESH_TIMEOUT_MS, remainingMs),
  );
  timer.unref?.();
  try {
    const response = await (context.fetcher ?? fetch)(refreshUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: refreshClientId(env),
        refresh_token: auth.refreshToken,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw refreshFailure();
    const data = objectValue(await response.json());
    if (!data) throw refreshFailure();
    const accessToken = firstString(data.access_token, data.id_token);
    const refreshToken = firstString(data.refresh_token);
    const idToken = firstString(data.id_token);
    const claims = decodeJwtPayload(idToken ?? accessToken);
    const claimsAuth = authClaim(claims);
    const accountId = firstString(
      data.account_id,
      data.chatgpt_account_id,
      claims?.chatgpt_account_id,
      claims?.account_id,
      claimsAuth?.chatgpt_account_id,
      claimsAuth?.account_id,
      auth.chatgptAccountId,
    );
    if (!accessToken || !accountId) throw refreshFailure();
    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      accountId,
      ...(idToken ? { idToken } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Managed Codex authentication refresh failed.') throw error;
    throw refreshFailure();
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshManagedCodexAuth(
  auth: ManagedCodexAuth,
  context: ManagedCodexAuthRefreshContext = {},
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManagedCodexAuth> {
  if (auth.kind !== 'chatgpt') {
    throw new Error('Managed Codex API key does not support token refresh.');
  }

  const callbackTimeoutMs = Math.max(1, context.timeoutMs ?? CODEX_REFRESH_CALLBACK_TIMEOUT_MS);
  const deadline = Date.now() + callbackTimeoutMs;
  let refreshed: ManagedCodexAuth | undefined;
  const persistOperation = persistRegisteredCredentialFile(
    'codex',
    { accountId: auth.accountId, credentialVersion: auth.credentialVersion },
    async (registeredPath) => {
      // The pool serializer may wait behind another in-process operation and
      // then behind the file lock. Do not perform any read, network refresh,
      // or write once the native callback's deadline has elapsed.
      throwIfRefreshExpired(deadline);
      if (resolve(registeredPath) !== auth.sourcePath) throw new Error(MANAGED_AUTH_INVALID_ERROR);
      let record: unknown;
      try {
        record = JSON.parse(await readFile(registeredPath, 'utf8'));
      } catch {
        throw new Error(MANAGED_AUTH_INVALID_ERROR);
      }
      const parsed = objectValue(record);
      if (!parsed) throw new Error(MANAGED_AUTH_INVALID_ERROR);
      const latest = parseManagedCodexAuthRecord(parsed, auth);
      if (latest.kind !== 'chatgpt') throw new Error(MANAGED_AUTH_INVALID_ERROR);
      throwIfRefreshExpired(deadline);

      // Another process may have refreshed while this client was waiting for
      // the pool lock. Use its newer token and avoid a duplicate network call.
      if (latest.accessToken !== auth.accessToken) {
        refreshed = latest;
        return;
      }

      const tokens = await refreshTokens(latest, context, env, deadline);
      throwIfRefreshExpired(deadline);
      const latestTokens = objectValue(parsed.tokens) ?? {};
      const updatedRecord: JsonRecord = {
        ...parsed,
        tokens: {
          ...latestTokens,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken ?? latest.refreshToken,
          account_id: tokens.accountId,
          ...(tokens.idToken ? { id_token: tokens.idToken } : {}),
        },
        last_refresh: new Date().toISOString(),
      };
      await writeCredentialBytes(registeredPath, Buffer.from(`${JSON.stringify(updatedRecord, null, 2)}\n`));
      refreshed = parseManagedCodexAuthRecord(updatedRecord, auth);
    },
    paths,
  );
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => reject(refreshTimeout()), callbackTimeoutMs);
    timeoutTimer.unref?.();
  });
  let persisted: boolean;
  try {
    persisted = await Promise.race([persistOperation, timeout]);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
  if (!persisted) throw new Error(MANAGED_AUTH_REMOVED_ERROR);
  if (!refreshed) throw refreshFailure();
  return refreshed;
}
