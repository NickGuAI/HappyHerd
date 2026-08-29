import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { configuration } from '@/configuration';
import {
  CredentialPoolStateSchema,
  type CredentialAccount,
  type CredentialPoolRotation,
  type CredentialPoolSelection,
  type CredentialPoolState,
  type CredentialProvider,
} from './types';

export type CredentialPoolPaths = {
  stateFile: string;
  accountsDir: string;
};

export const defaultCredentialPoolPaths = (): CredentialPoolPaths => ({
  stateFile: configuration.credentialPoolFile,
  accountsDir: configuration.credentialPoolDir,
});

const stateOperationTails = new Map<string, Promise<void>>();
const LOCK_RETRY_INTERVAL_MS = 100;
const MAX_LOCK_ATTEMPTS = 50;
const STALE_LOCK_TIMEOUT_MS = 10_000;

async function withCredentialPoolFileLock<T>(
  paths: CredentialPoolPaths,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(paths.stateFile), { recursive: true });
  const lockFile = `${paths.stateFile}.lock`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;

  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    try {
      lock = await open(lockFile, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LOCK_RETRY_INTERVAL_MS));
      try {
        const lockStats = await stat(lockFile);
        if (Date.now() - lockStats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
          await unlink(lockFile).catch(() => {});
        }
      } catch {}
    }
  }

  if (!lock) {
    throw new Error(
      `Failed to acquire credential pool lock after ${MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS / 1_000} seconds`,
    );
  }

  try {
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockFile).catch(() => {});
  }
}

async function serializeCredentialPoolState<T>(
  paths: CredentialPoolPaths,
  operation: () => Promise<T>,
): Promise<T> {
  const key = resolve(paths.stateFile);
  const previous = stateOperationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.then(() => gate);
  stateOperationTails.set(key, tail);
  await previous;
  try {
    return await withCredentialPoolFileLock(paths, operation);
  } finally {
    release();
    if (stateOperationTails.get(key) === tail) stateOperationTails.delete(key);
  }
}

export function emptyCredentialPoolState(): CredentialPoolState {
  return { schemaVersion: 1, current: {}, accounts: [] };
}

export function validateAccountName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Account nickname must be 1-64 letters, numbers, dots, underscores, or dashes.');
  }
  return name;
}

export function accountHome(
  provider: Exclude<CredentialProvider, 'claude'>,
  name: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): string {
  return join(paths.accountsDir, provider, validateAccountName(name));
}

export function accountAuthFile(
  provider: Exclude<CredentialProvider, 'claude'>,
  name: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): string {
  return join(accountHome(provider, name, paths), 'auth.json');
}

async function readCredentialPoolStateUnlocked(
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<CredentialPoolState> {
  try {
    const raw = JSON.parse(await readFile(paths.stateFile, 'utf8'));
    return CredentialPoolStateSchema.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyCredentialPoolState();
    }
    throw error;
  }
}

export async function readCredentialPoolState(
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<CredentialPoolState> {
  return serializeCredentialPoolState(paths, () => readCredentialPoolStateUnlocked(paths));
}

async function writeCredentialPoolStateUnlocked(
  state: CredentialPoolState,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<void> {
  const parsed = CredentialPoolStateSchema.parse(state);
  await mkdir(dirname(paths.stateFile), { recursive: true });
  await mkdir(paths.accountsDir, { recursive: true, mode: 0o700 });
  await chmod(paths.accountsDir, 0o700);
  const temporaryFile = `${paths.stateFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryFile, paths.stateFile);
    await chmod(paths.stateFile, 0o600);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

export async function writeCredentialPoolState(
  state: CredentialPoolState,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<void> {
  return serializeCredentialPoolState(paths, () => writeCredentialPoolStateUnlocked(state, paths));
}

export async function listCredentialAccounts(
  provider?: CredentialProvider,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<{ state: CredentialPoolState; accounts: CredentialAccount[] }> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    return {
      state,
      accounts: state.accounts.filter((account) => !provider || account.provider === provider),
    };
  });
}

export async function upsertCredentialAccount(
  account: Omit<CredentialAccount, 'createdAt' | 'updatedAt' | 'limitedUntil'> & {
    createdAt?: number;
    updatedAt?: number;
    limitedUntil?: number | null;
  },
  options: { paths?: CredentialPoolPaths; now?: number } = {},
): Promise<CredentialAccount> {
  const paths = options.paths ?? defaultCredentialPoolPaths();
  return serializeCredentialPoolState(paths, async () => {
    const now = options.now ?? Date.now();
    const name = validateAccountName(account.name);
    const state = await readCredentialPoolStateUnlocked(paths);
    const existingIndex = state.accounts.findIndex(
      (candidate) => candidate.provider === account.provider && candidate.name === name,
    );
    const existing = existingIndex >= 0 ? state.accounts[existingIndex] : undefined;
    const next = CredentialPoolStateSchema.shape.accounts.element.parse({
      ...account,
      name,
      createdAt: account.createdAt ?? existing?.createdAt ?? now,
      updatedAt: account.updatedAt ?? now,
      limitedUntil: account.limitedUntil ?? null,
    });
    if (existingIndex >= 0) {
      state.accounts[existingIndex] = next;
    } else {
      state.accounts.push(next);
    }
    state.current[account.provider] ??= name;
    await writeCredentialPoolStateUnlocked(state, paths);
    return next;
  });
}

function providerAccounts(state: CredentialPoolState, provider: CredentialProvider): CredentialAccount[] {
  return state.accounts.filter((account) => account.provider === provider);
}

function available(account: CredentialAccount, now: number): boolean {
  return account.limitedUntil === null || account.limitedUntil <= now;
}

function clearExpiredLimits(accounts: CredentialAccount[], now: number): boolean {
  let changed = false;
  for (const account of accounts) {
    if (account.limitedUntil !== null && account.limitedUntil <= now) {
      account.limitedUntil = null;
      account.updatedAt = now;
      changed = true;
    }
  }
  return changed;
}

function earliestLimit(accounts: CredentialAccount[]): number {
  return Math.min(...accounts.map((account) => account.limitedUntil ?? Number.POSITIVE_INFINITY));
}

function rotatedAccounts(accounts: CredentialAccount[], afterName?: string): CredentialAccount[] {
  if (!afterName) return accounts;
  const index = accounts.findIndex((account) => account.name === afterName);
  if (index < 0) return accounts;
  return [...accounts.slice(index + 1), ...accounts.slice(0, index + 1)];
}

export async function selectCredentialAccount(
  provider: CredentialProvider,
  options: { preferred?: string; paths?: CredentialPoolPaths; now?: number } = {},
): Promise<CredentialPoolSelection> {
  const paths = options.paths ?? defaultCredentialPoolPaths();
  return serializeCredentialPoolState(paths, async () => {
    const now = options.now ?? Date.now();
    const state = await readCredentialPoolStateUnlocked(paths);
    const accounts = providerAccounts(state, provider);
    if (accounts.length === 0) return { type: 'unconfigured' };
    const clearedExpiredLimits = clearExpiredLimits(accounts, now);

    const anchor = options.preferred ?? state.current[provider];
    const preferred = anchor ? accounts.find((account) => account.name === anchor) : undefined;
    const selected = preferred && available(preferred, now)
      ? preferred
      : rotatedAccounts(accounts, anchor).find((account) => available(account, now));
    if (!selected) {
      return { type: 'all-limited', limitedUntil: earliestLimit(accounts) };
    }
    if (state.current[provider] !== selected.name || clearedExpiredLimits) {
      state.current[provider] = selected.name;
      await writeCredentialPoolStateUnlocked(state, paths);
    }
    return { type: 'available', account: selected };
  });
}

export async function markCredentialAccountLimited(
  provider: CredentialProvider,
  name: string,
  limitedUntil: number,
  options: { paths?: CredentialPoolPaths; now?: number } = {},
): Promise<CredentialPoolRotation> {
  const paths = options.paths ?? defaultCredentialPoolPaths();
  return serializeCredentialPoolState(paths, async () => {
    const now = options.now ?? Date.now();
    const state = await readCredentialPoolStateUnlocked(paths);
    const account = state.accounts.find(
      (candidate) => candidate.provider === provider && candidate.name === name,
    );
    if (!account) return { type: 'ignored' };

    account.limitedUntil = Math.max(limitedUntil, now + 1);
    account.updatedAt = now;
    const accounts = providerAccounts(state, provider);
    clearExpiredLimits(accounts, now);
    const next = rotatedAccounts(accounts, name).find((candidate) => available(candidate, now));
    if (next) {
      state.current[provider] = next.name;
      await writeCredentialPoolStateUnlocked(state, paths);
      return { type: 'next-account', account: next };
    }

    state.current[provider] = name;
    await writeCredentialPoolStateUnlocked(state, paths);
    return { type: 'all-limited', limitedUntil: earliestLimit(accounts) };
  });
}

export async function useCredentialAccount(
  provider: CredentialProvider,
  name: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<CredentialAccount> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const account = state.accounts.find(
      (candidate) => candidate.provider === provider && candidate.name === validateAccountName(name),
    );
    if (!account) throw new Error(`No ${provider} account named "${name}".`);
    state.current[provider] = account.name;
    await writeCredentialPoolStateUnlocked(state, paths);
    return account;
  });
}

export async function removeCredentialAccount(
  provider: CredentialProvider,
  name: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<CredentialAccount> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const normalizedName = validateAccountName(name);
    const index = state.accounts.findIndex(
      (candidate) => candidate.provider === provider && candidate.name === normalizedName,
    );
    if (index < 0) throw new Error(`No ${provider} account named "${name}".`);
    const [removed] = state.accounts.splice(index, 1);
    const remaining = providerAccounts(state, provider);
    if (state.current[provider] === normalizedName) {
      if (remaining[0]) state.current[provider] = remaining[0].name;
      else delete state.current[provider];
    }
    await writeCredentialPoolStateUnlocked(state, paths);
    if (removed.provider !== 'claude') {
      await rm(accountHome(removed.provider, normalizedName, paths), {
        recursive: true,
        force: true,
      });
    }
    return removed;
  });
}

export function credentialAccountEnvironment(account: CredentialAccount): Record<string, string> {
  const common = {
    HAPPYHERD_PROVIDER_ACCOUNT: account.name,
    HAPPYHERD_PROVIDER_ACCOUNT_TYPE: account.provider,
  };
  if (account.provider === 'claude') {
    return { ...common, CLAUDE_CODE_OAUTH_TOKEN: account.credential.token };
  }
  if (account.provider === 'codex') {
    return { ...common, HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: account.credential.path };
  }
  return { ...common, HAPPYHERD_GROK_ACCOUNT_AUTH_FILE: account.credential.path };
}

export async function resolveCredentialAccountEnvironment(
  provider: CredentialProvider,
  options: { preferred?: string; paths?: CredentialPoolPaths; now?: number } = {},
): Promise<{ selection: CredentialPoolSelection; env: Record<string, string> }> {
  const selection = await selectCredentialAccount(provider, options);
  return {
    selection,
    env: selection.type === 'available' ? credentialAccountEnvironment(selection.account) : {},
  };
}
