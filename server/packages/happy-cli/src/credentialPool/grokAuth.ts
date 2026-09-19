import { chmod, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CredentialAccount } from './types';
import {
  defaultCredentialPoolPaths,
  persistRegisteredCredentialFile,
  writeCredentialBytes,
  type CredentialPoolPaths,
} from './store';
import { activateRuntimeAuthCredential, runtimeAuthOwnershipMatches, withRuntimeAuthLock } from './runtimeAuthOwnership';

type GrokCredentialAccount = Extract<CredentialAccount, { provider: 'grok' }>;

export function grokRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.GROK_HOME?.trim() || join(homedir(), '.grok'));
}

export async function activateGrokCredential(
  account: GrokCredentialAccount,
  runtimeHome: string = grokRuntimeHome(),
): Promise<void> {
  await activateRuntimeAuthCredential(account, runtimeHome);
}

export async function persistActiveGrokCredential(
  env: NodeJS.ProcessEnv = process.env,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<boolean> {
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) return false;
  const runtimeHome = grokRuntimeHome(env);
  return withRuntimeAuthLock(runtimeHome, async () => {
    if (!(await runtimeAuthOwnershipMatches('grok', runtimeHome, env))) return false;
    const runtimeAuthFile = join(runtimeHome, 'auth.json');
    // Snapshot the source while managed activation is excluded; destination
    // registration and relogin version are still checked by the pool store.
    const bytes = await readFile(runtimeAuthFile);
    await chmod(runtimeAuthFile, 0o600);
    return persistRegisteredCredentialFile('grok', { accountId, credentialVersion }, async (accountAuthFile) => {
      if (resolve(accountAuthFile) !== resolve(runtimeAuthFile)) {
        await writeCredentialBytes(accountAuthFile, bytes);
      }
    }, paths);
  });
}
