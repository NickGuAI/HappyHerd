import { chmod, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { CredentialAccount } from './types';
import {
  defaultCredentialPoolPaths,
  credentialAccountPersistenceId,
  persistRegisteredCredentialFile,
  writeCredentialBytes,
  type CredentialPoolPaths,
} from './store';

type GrokCredentialAccount = Extract<CredentialAccount, { provider: 'grok' }>;

const RUNTIME_AUTH_DIRECTORY = '.happyherd-runtime-auth';

function versionedGrokAuthPath(
  accountAuthFile: string,
  accountId: string,
  credentialVersion: number,
): string {
  return resolve(
    dirname(accountAuthFile),
    RUNTIME_AUTH_DIRECTORY,
    accountId,
    `v${credentialVersion}`,
    'auth.json',
  );
}

async function initializeVersionedGrokAuth(accountAuthFile: string, runtimeAuthFile: string): Promise<void> {
  try {
    await readFile(runtimeAuthFile);
    await chmod(dirname(runtimeAuthFile), 0o700);
    await chmod(runtimeAuthFile, 0o600);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeCredentialBytes(runtimeAuthFile, await readFile(accountAuthFile));
}

export function grokRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.GROK_HOME?.trim() || join(homedir(), '.grok'));
}

export async function activateGrokCredential(
  account: GrokCredentialAccount,
  _runtimeHome: string = grokRuntimeHome(),
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<string> {
  const registration = {
    accountId: credentialAccountPersistenceId(account),
    credentialVersion: account.credentialVersion,
  };
  let runtimeAuthFile: string | undefined;
  const registered = await persistRegisteredCredentialFile('grok', registration, async (accountAuthFile) => {
    runtimeAuthFile = versionedGrokAuthPath(
      accountAuthFile,
      registration.accountId,
      registration.credentialVersion,
    );
    // A native refresh owns this version-specific file after first launch.
    // Reusing it must never restore older bytes from the registered source.
    await initializeVersionedGrokAuth(accountAuthFile, runtimeAuthFile);
  }, paths);
  if (!registered || !runtimeAuthFile) {
    throw new Error(`Grok account "${account.name}" changed before activation. Refresh accounts and retry.`);
  }
  return runtimeAuthFile;
}

export async function persistActiveGrokCredential(
  env: NodeJS.ProcessEnv = process.env,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<boolean> {
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) return false;
  const sourceAuthFile = env.GROK_AUTH_PATH?.trim();
  if (!sourceAuthFile) return false;
  let persisted = false;
  const registered = await persistRegisteredCredentialFile('grok', { accountId, credentialVersion }, async (accountAuthFile) => {
    const expectedSource = versionedGrokAuthPath(accountAuthFile, accountId, credentialVersion);
    if (resolve(sourceAuthFile) !== expectedSource) return;
    const bytes = await readFile(expectedSource);
    await chmod(dirname(expectedSource), 0o700);
    await chmod(expectedSource, 0o600);
    await writeCredentialBytes(accountAuthFile, bytes);
    persisted = true;
  }, paths);
  return registered && persisted;
}
