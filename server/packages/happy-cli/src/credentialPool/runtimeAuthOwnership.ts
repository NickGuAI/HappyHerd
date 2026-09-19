import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { CredentialAccount } from './types';
import { credentialAccountPersistenceId, serializeCredentialPoolState, writeCredentialBytes } from './store';

type FileCredentialProvider = 'codex' | 'grok';
type FileCredentialAccount = Extract<CredentialAccount, { provider: FileCredentialProvider }>;

type RuntimeAuthOwner = {
  provider: FileCredentialProvider;
  accountId: string;
  credentialVersion: number;
};

const OWNER_FILE = '.happyherd-credential-owner.json';

export function runtimeAuthOwnerPath(runtimeHome: string): string {
  return join(runtimeHome, OWNER_FILE);
}

// Reuse the existing pool queue and cross-process file lock for each shared
// runtime slot. Always take this lock before the registration/state lock.
export function withRuntimeAuthLock<T>(runtimeHome: string, operation: () => Promise<T>): Promise<T> {
  return serializeCredentialPoolState({
    stateFile: runtimeAuthOwnerPath(runtimeHome),
    accountsDir: runtimeHome,
  }, operation);
}

export async function activateRuntimeAuthCredential(
  account: FileCredentialAccount,
  runtimeHome: string,
): Promise<void> {
  await withRuntimeAuthLock(runtimeHome, async () => {
    // A missing source must not claim the old credential for the new account.
    const bytes = await readFile(account.credential.path);
    const owner: RuntimeAuthOwner = {
      provider: account.provider,
      accountId: credentialAccountPersistenceId(account),
      credentialVersion: account.credentialVersion,
    };
    const ownerFile = runtimeAuthOwnerPath(runtimeHome);
    await rm(ownerFile, { force: true });
    await writeCredentialBytes(join(runtimeHome, 'auth.json'), bytes);
    // Publish provenance only after replacement. A crash between the files
    // leaves an unowned slot, never the new owner attached to the old auth.
    await writeCredentialBytes(ownerFile, Buffer.from(`${JSON.stringify(owner)}\n`));
  });
}

function expectedRuntimeAuthOwner(
  provider: FileCredentialProvider,
  env: NodeJS.ProcessEnv,
): RuntimeAuthOwner | null {
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) return null;
  return { provider, accountId, credentialVersion };
}

// Hold withRuntimeAuthLock when this check authorizes a subsequent file copy.
// This marker describes managed activation, not arbitrary external native writes.
export async function runtimeAuthOwnershipMatches(
  provider: FileCredentialProvider,
  runtimeHome: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const expected = expectedRuntimeAuthOwner(provider, env);
  if (!expected) return false;
  try {
    const parsed = JSON.parse(await readFile(runtimeAuthOwnerPath(runtimeHome), 'utf8')) as Partial<RuntimeAuthOwner>;
    return parsed.provider === expected.provider
      && parsed.accountId === expected.accountId
      && parsed.credentialVersion === expected.credentialVersion;
  } catch {
    return false;
  }
}
