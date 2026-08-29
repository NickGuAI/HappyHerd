import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { CredentialAccount } from './types';

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
): Promise<boolean> {
  const accountAuthFile = env.HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE?.trim();
  if (!accountAuthFile) return false;
  const runtimeAuthFile = join(codexRuntimeHome(env), 'auth.json');
  if (resolve(accountAuthFile) === resolve(runtimeAuthFile)) {
    await chmod(runtimeAuthFile, 0o600);
    return true;
  }
  await mkdir(dirname(accountAuthFile), { recursive: true, mode: 0o700 });
  await chmod(dirname(accountAuthFile), 0o700);
  await copyFile(runtimeAuthFile, accountAuthFile);
  await chmod(accountAuthFile, 0o600);
  return true;
}
