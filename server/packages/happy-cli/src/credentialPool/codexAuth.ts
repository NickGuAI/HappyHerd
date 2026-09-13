import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { CredentialAccount } from './types';
import {
  defaultCredentialPoolPaths,
  persistRegisteredCredentialFile,
  type CredentialPoolPaths,
} from './store';

type CodexCredentialAccount = Extract<CredentialAccount, { provider: 'codex' }>;

export function codexRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.CODEX_HOME?.trim() || join(homedir(), '.codex'));
}

export async function activateCodexCredential(
  account: CodexCredentialAccount,
  runtimeHome: string = codexRuntimeHome(),
): Promise<void> {
  const runtimeAuthFile = join(runtimeHome, 'auth.json');
  if (resolve(account.credential.path) === resolve(runtimeAuthFile)) {
    await chmod(runtimeAuthFile, 0o600);
    return;
  }
  await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
  await copyFile(account.credential.path, runtimeAuthFile);
  await chmod(runtimeAuthFile, 0o600);
}

export async function persistActiveCodexCredential(
  env: NodeJS.ProcessEnv = process.env,
  paths: CredentialPoolPaths = defaultCredentialPoolPaths(),
): Promise<boolean> {
  const accountId = env.HAPPYHERD_PROVIDER_ACCOUNT_ID?.trim();
  const rawCredentialVersion = env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION?.trim();
  const credentialVersion = rawCredentialVersion === undefined ? Number.NaN : Number(rawCredentialVersion);
  if (!accountId || !Number.isInteger(credentialVersion) || credentialVersion < 1) return false;
  const runtimeAuthFile = join(codexRuntimeHome(env), 'auth.json');
  return persistRegisteredCredentialFile('codex', {
    accountId,
    credentialVersion,
  }, async (accountAuthFile) => {
    if (resolve(accountAuthFile) === resolve(runtimeAuthFile)) {
      await chmod(runtimeAuthFile, 0o600);
      return;
    }
    await mkdir(dirname(accountAuthFile), { recursive: true, mode: 0o700 });
    await chmod(dirname(accountAuthFile), 0o700);
    await copyFile(runtimeAuthFile, accountAuthFile);
    await chmod(accountAuthFile, 0o600);
  }, paths);
}
