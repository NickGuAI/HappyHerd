import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { configuration } from '@/configuration';
import {
  CredentialPoolStateSchema,
  LegacyCredentialPoolStateSchema,
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

export type CredentialAccountExpectation = {
  id: string;
  credentialVersion: number;
};

export type CredentialLoginTarget =
  | { type: 'new' }
  | ({ type: 'existing' } & CredentialAccountExpectation);

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
  return { schemaVersion: 2, current: {}, accounts: [] };
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
    const current = CredentialPoolStateSchema.safeParse(raw);
    if (current.success) return current.data;
    const legacy = LegacyCredentialPoolStateSchema.parse(raw);
    const migrated = CredentialPoolStateSchema.parse({
      schemaVersion: 2,
      current: legacy.current,
      accounts: legacy.accounts.map((account) => ({
        ...account,
        id: randomUUID(),
        credentialVersion: 1,
      })),
    });
    await writeCredentialPoolStateUnlocked(migrated, paths);
    return migrated;
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
  account: Omit<CredentialAccount, 'id' | 'credentialVersion' | 'createdAt' | 'updatedAt' | 'limitedUntil'> & {
    id?: string;
    credentialVersion?: number;
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
      id: account.id ?? existing?.id ?? randomUUID(),
      name,
      createdAt: account.createdAt ?? existing?.createdAt ?? now,
      updatedAt: account.updatedAt ?? now,
      limitedUntil: account.limitedUntil ?? null,
      credentialVersion: account.credentialVersion ?? (existing?.credentialVersion ?? 0) + 1,
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

async function writeCredentialBytes(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function commitCredentialLogin(
  input: {
    provider: 'claude';
    name: string;
    token: string;
  } | {
    provider: 'codex' | 'grok';
    name: string;
    authFile: Buffer;
  },
  options: {
    paths?: CredentialPoolPaths;
    now?: number;
    writeState?: typeof writeCredentialPoolStateUnlocked;
    writeCredential?: typeof writeCredentialBytes;
    target?: CredentialLoginTarget;
  } = {},
): Promise<CredentialAccount> {
  const paths = options.paths ?? defaultCredentialPoolPaths();
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const name = validateAccountName(input.name);
    const now = options.now ?? Date.now();
    const existingIndex = state.accounts.findIndex(
      (candidate) => candidate.provider === input.provider && candidate.name === name,
    );
    const existing = existingIndex >= 0 ? state.accounts[existingIndex] : undefined;
    if (options.target?.type === 'new' && existing) {
      throw new Error(`A ${input.provider} account named "${name}" already exists. Refresh accounts and retry.`);
    }
    if (options.target?.type === 'existing' && (
      !existing
      || existing.id !== options.target.id
      || existing.credentialVersion !== options.target.credentialVersion
    )) {
      throw new Error('This provider account changed. Refresh accounts and retry.');
    }
    const id = existing?.id ?? randomUUID();
    let next: CredentialAccount;
    let authFileRollback: { path: string; bytes: Buffer | null; createdHome: boolean } | null = null;

    if (input.provider === 'claude') {
      next = CredentialPoolStateSchema.shape.accounts.element.parse({
        provider: input.provider,
        id,
        name,
        credential: { type: 'oauth-token', token: input.token },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        limitedUntil: null,
        credentialVersion: (existing?.credentialVersion ?? 0) + 1,
      });
    } else {
      const reusableHome = existing && existing.provider !== 'claude'
        ? managedCredentialHome(existing, paths)
        : null;
      const path = reusableHome
        ? join(reusableHome, 'auth.json')
        : join(paths.accountsDir, input.provider, id, 'auth.json');
      let createdHome = false;
      if (!existing) {
        try {
          await stat(dirname(path));
          throw new Error(`Credential storage for ${input.provider} account "${name}" already exists.`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          createdHome = true;
        }
      }
      let previous: Buffer | null = null;
      try {
        previous = await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await (options.writeCredential ?? writeCredentialBytes)(path, input.authFile);
      } catch (error) {
        if (createdHome) {
          try {
            await rm(path, { force: true });
            await rmdir(dirname(path));
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'Provider login failed and its new credential storage could not be removed.',
            );
          }
        }
        throw error;
      }
      authFileRollback = { path, bytes: previous, createdHome };
      next = CredentialPoolStateSchema.shape.accounts.element.parse({
        provider: input.provider,
        id,
        name,
        credential: { type: 'auth-file', path },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        limitedUntil: null,
        credentialVersion: (existing?.credentialVersion ?? 0) + 1,
      });
    }

    if (existingIndex >= 0) state.accounts[existingIndex] = next;
    else state.accounts.push(next);
    state.current[input.provider] ??= name;
    try {
      await (options.writeState ?? writeCredentialPoolStateUnlocked)(state, paths);
    } catch (error) {
      if (authFileRollback) {
        try {
          if (authFileRollback.bytes) {
            await writeCredentialBytes(authFileRollback.path, authFileRollback.bytes);
          } else {
            await rm(authFileRollback.path, { force: true });
            if (authFileRollback.createdHome) await rmdir(dirname(authFileRollback.path));
          }
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Provider login failed and its credential storage could not be restored.',
          );
        }
      }
      throw error;
    }
    return next;
  });
}

export function credentialAccountPersistenceId(account: CredentialAccount): string {
  return account.id;
}

export async function persistRegisteredCredentialFile(
  provider: 'codex' | 'grok',
  registration: {
    accountId: string;
    credentialVersion: number;
  },
  persist: (credentialPath: string) => Promise<void>,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<boolean> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const account = state.accounts.find((candidate) => (
      candidate.provider === provider
      && credentialAccountPersistenceId(candidate) === registration.accountId
      && candidate.credentialVersion === registration.credentialVersion
    ));
    if (!account || account.provider === 'claude') return false;
    await persist(account.credential.path);
    return true;
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
  options: { preferred?: string; preferredId?: string; paths?: CredentialPoolPaths; now?: number } = {},
): Promise<CredentialPoolSelection> {
  const paths = options.paths ?? defaultCredentialPoolPaths();
  return serializeCredentialPoolState(paths, async () => {
    const now = options.now ?? Date.now();
    const state = await readCredentialPoolStateUnlocked(paths);
    const accounts = providerAccounts(state, provider);
    if (accounts.length === 0) return { type: 'unconfigured' };
    const clearedExpiredLimits = clearExpiredLimits(accounts, now);

    const accountById = options.preferredId
      ? accounts.find((account) => account.id === options.preferredId)
      : undefined;
    const anchor = accountById?.name
      ?? (options.preferredId ? state.current[provider] : options.preferred ?? state.current[provider]);
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
  options: {
    paths?: CredentialPoolPaths;
    now?: number;
    accountId?: string;
    credentialVersion?: number;
  } = {},
): Promise<CredentialPoolRotation> {
  const paths = options.paths ?? defaultCredentialPoolPaths();
  return serializeCredentialPoolState(paths, async () => {
    const now = options.now ?? Date.now();
    const state = await readCredentialPoolStateUnlocked(paths);
    const account = state.accounts.find((candidate) => (
      candidate.provider === provider
      && (options.accountId ? candidate.id === options.accountId : candidate.name === name)
    ));
    if (!account) return { type: 'ignored' };
    if (options.accountId && options.credentialVersion !== undefined
      && account.credentialVersion !== options.credentialVersion) {
      return { type: 'credential-changed', account: account.name };
    }
    const resolvedName = account.name;

    account.limitedUntil = Math.max(limitedUntil, now + 1);
    account.updatedAt = now;
    const accounts = providerAccounts(state, provider);
    clearExpiredLimits(accounts, now);
    const next = rotatedAccounts(accounts, resolvedName).find((candidate) => available(candidate, now));
    if (next) {
      state.current[provider] = next.name;
      await writeCredentialPoolStateUnlocked(state, paths);
      return { type: 'next-account', account: next, fromAccount: resolvedName };
    }

    state.current[provider] = resolvedName;
    await writeCredentialPoolStateUnlocked(state, paths);
    return { type: 'all-limited', limitedUntil: earliestLimit(accounts), fromAccount: resolvedName };
  });
}

export async function useCredentialAccount(
  provider: CredentialProvider,
  name: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
  expected?: CredentialAccountExpectation,
): Promise<CredentialAccount> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const normalizedName = validateAccountName(name);
    const account = state.accounts.find((candidate) => (
      candidate.provider === provider
      && (expected ? candidate.id === expected.id : candidate.name === normalizedName)
    ));
    if (!account) throw new Error(`No ${provider} account named "${name}".`);
    if (account.name !== normalizedName || (expected && account.credentialVersion !== expected.credentialVersion)) {
      throw new Error('This provider account changed. Refresh accounts and retry.');
    }
    state.current[provider] = account.name;
    await writeCredentialPoolStateUnlocked(state, paths);
    return account;
  });
}

export async function renameCredentialAccount(
  provider: CredentialProvider,
  name: string,
  newName: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
  expected?: CredentialAccountExpectation,
): Promise<CredentialAccount> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const normalizedName = validateAccountName(name);
    const normalizedNewName = validateAccountName(newName);
    const account = state.accounts.find((candidate) => (
      candidate.provider === provider
      && (expected ? candidate.id === expected.id : candidate.name === normalizedName)
    ));
    if (!account) throw new Error(`No ${provider} account named "${name}".`);
    if (account.name !== normalizedName || (expected && account.credentialVersion !== expected.credentialVersion)) {
      throw new Error('This provider account changed. Refresh accounts and retry.');
    }
    if (normalizedName === normalizedNewName) return account;
    if (state.accounts.some(
      (candidate) => candidate.provider === provider && candidate.name === normalizedNewName,
    )) {
      throw new Error(`A ${provider} account named "${normalizedNewName}" already exists.`);
    }

    account.name = normalizedNewName;
    account.updatedAt = Date.now();
    if (state.current[provider] === normalizedName) state.current[provider] = normalizedNewName;
    await writeCredentialPoolStateUnlocked(state, paths);
    return account;
  });
}

function managedCredentialHome(
  account: Exclude<CredentialAccount, { provider: 'claude' }>,
  paths: CredentialPoolPaths,
): string | null {
  const providerRoot = resolve(paths.accountsDir, account.provider);
  const home = resolve(dirname(account.credential.path));
  return dirname(home) === providerRoot && basename(account.credential.path) === 'auth.json'
    ? home
    : null;
}

export async function removeCredentialAccount(
  provider: CredentialProvider,
  name: string,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
  expected?: CredentialAccountExpectation,
): Promise<CredentialAccount> {
  return serializeCredentialPoolState(paths, async () => {
    const state = await readCredentialPoolStateUnlocked(paths);
    const previousState = CredentialPoolStateSchema.parse(state);
    const normalizedName = validateAccountName(name);
    const index = state.accounts.findIndex((candidate) => (
      candidate.provider === provider
      && (expected ? candidate.id === expected.id : candidate.name === normalizedName)
    ));
    if (index < 0) throw new Error(`No ${provider} account named "${name}".`);
    const removed = state.accounts[index];
    if (removed.name !== normalizedName || (expected && removed.credentialVersion !== expected.credentialVersion)) {
      throw new Error('This provider account changed. Refresh accounts and retry.');
    }
    const remainingBeforeCommit = state.accounts.filter((_, candidateIndex) => candidateIndex !== index);
    let quarantinedHome: { original: string; quarantine: string } | null = null;
    if (removed.provider !== 'claude') {
      const home = managedCredentialHome(removed, paths);
      const shared = home && remainingBeforeCommit.some((candidate) => (
        candidate.provider !== 'claude'
        && managedCredentialHome(candidate, paths) === home
      ));
      if (home && !shared) {
        const quarantine = `${home}.removing-${randomUUID()}`;
        try {
          await rename(home, quarantine);
          quarantinedHome = { original: home, quarantine };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    state.accounts.splice(index, 1);
    const remaining = providerAccounts(state, provider);
    if (state.current[provider] === normalizedName) {
      if (remaining[0]) state.current[provider] = remaining[0].name;
      else delete state.current[provider];
    }
    try {
      await writeCredentialPoolStateUnlocked(state, paths);
    } catch (error) {
      if (quarantinedHome) {
        try {
          await rename(quarantinedHome.quarantine, quarantinedHome.original);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Account removal failed and its credential storage could not be restored.',
          );
        }
      }
      throw error;
    }

    if (quarantinedHome) {
      try {
        await rm(quarantinedHome.quarantine, { recursive: true, force: true });
      } catch (error) {
        try {
          await rename(quarantinedHome.quarantine, quarantinedHome.original);
          await writeCredentialPoolStateUnlocked(previousState, paths);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Account removal failed and could not be rolled back.',
          );
        }
        throw error;
      }
    }
    return removed;
  });
}

export function credentialAccountEnvironment(account: CredentialAccount): Record<string, string> {
  const common = {
    HAPPYHERD_PROVIDER_ACCOUNT: account.name,
    HAPPYHERD_PROVIDER_ACCOUNT_TYPE: account.provider,
    HAPPYHERD_PROVIDER_ACCOUNT_ID: credentialAccountPersistenceId(account),
    HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION: String(account.credentialVersion),
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
  options: { preferred?: string; preferredId?: string; paths?: CredentialPoolPaths; now?: number } = {},
): Promise<{ selection: CredentialPoolSelection; env: Record<string, string> }> {
  const selection = await selectCredentialAccount(provider, options);
  return {
    selection,
    env: selection.type === 'available' ? credentialAccountEnvironment(selection.account) : {},
  };
}
