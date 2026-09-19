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

type CodexCredentialAccount = Extract<CredentialAccount, { provider: 'codex' }>;

export function codexRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.CODEX_HOME?.trim() || join(homedir(), '.codex'));
}

export async function activateCodexCredential(
  account: CodexCredentialAccount,
  runtimeHome: string = codexRuntimeHome(),
): Promise<void> {
  await activateRuntimeAuthCredential(account, runtimeHome);
}

export async function persistActiveCodexCredential(
  env: NodeJS.ProcessEnv = process.env,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<boolean> {
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) return false;
  const runtimeHome = codexRuntimeHome(env);
  return withRuntimeAuthLock(runtimeHome, async () => {
    if (!(await runtimeAuthOwnershipMatches('codex', runtimeHome, env))) return false;
    const runtimeAuthFile = join(runtimeHome, 'auth.json');
    // Snapshot the source while managed activation is excluded; destination
    // registration and relogin version are still checked by the pool store.
    const bytes = await readFile(runtimeAuthFile);
    await chmod(runtimeAuthFile, 0o600);
    return persistRegisteredCredentialFile('codex', { accountId, credentialVersion }, async (accountAuthFile) => {
      if (resolve(accountAuthFile) !== resolve(runtimeAuthFile)) {
        await writeCredentialBytes(accountAuthFile, bytes);
      }
    }, paths);
  });
}

export async function codexRuntimeCredentialOwnedByProcess(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE !== 'codex') return true;
  const home = codexRuntimeHome(env);
  return withRuntimeAuthLock(home, () => runtimeAuthOwnershipMatches('codex', home, env));
}
