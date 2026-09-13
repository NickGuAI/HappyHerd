import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { CredentialAccount } from './types';
import {
  defaultCredentialPoolPaths,
  persistRegisteredCredentialFile,
  type CredentialPoolPaths,
} from './store';

type GrokCredentialAccount = Extract<CredentialAccount, { provider: 'grok' }>;

export function grokRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.GROK_HOME?.trim() || join(homedir(), '.grok'));
}

export async function activateGrokCredential(
  account: GrokCredentialAccount,
  runtimeHome: string = grokRuntimeHome(),
): Promise<void> {
  const runtimeAuthFile = join(runtimeHome, 'auth.json');
  if (resolve(account.credential.path) === resolve(runtimeAuthFile)) {
    await chmod(runtimeAuthFile, 0o600);
    return;
  }
  await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
  await chmod(runtimeHome, 0o700);
  await chmod(account.credential.path, 0o600);
  await copyFile(account.credential.path, runtimeAuthFile);
  await chmod(runtimeAuthFile, 0o600);
}

export async function persistActiveGrokCredential(
  env: NodeJS.ProcessEnv = process.env,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<boolean> {
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) return false;
  const runtimeAuthFile = join(grokRuntimeHome(env), 'auth.json');
  return persistRegisteredCredentialFile('grok', {
    accountId,
    credentialVersion,
  }, async (accountAuthFile) => {
    if (resolve(accountAuthFile) === resolve(runtimeAuthFile)) {
      await chmod(runtimeAuthFile, 0o600);
      return;
    }
    await mkdir(dirname(accountAuthFile), { recursive: true, mode: 0o700 });
    await chmod(dirname(accountAuthFile), 0o700);
    await chmod(runtimeAuthFile, 0o600);
    await copyFile(runtimeAuthFile, accountAuthFile);
    await chmod(accountAuthFile, 0o600);
  }, paths);
}
