import { resolveCredentialAccountEnvironment, type CredentialPoolPaths } from './store';
import type { CredentialPoolSelection, CredentialProvider } from './types';
import { activateCodexCredential, codexRuntimeHome } from './codexAuth';
import { activateGrokCredential, grokRuntimeHome } from './grokAuth';
import { managedProviderDirectAuthKeys } from '@/daemon/sessionEnvironment';

export type ActivateCredentialAccountDependencies = {
  paths?: CredentialPoolPaths;
  env?: NodeJS.ProcessEnv;
};

export async function activateCredentialAccount(
  provider: CredentialProvider,
  dependencies: ActivateCredentialAccountDependencies = {},
): Promise<CredentialPoolSelection> {
  const targetEnv = dependencies.env ?? process.env;
  const preferred = targetEnv.HAPPYHERD_PROVIDER_ACCOUNT_TYPE === provider
    ? targetEnv.HAPPYHERD_PROVIDER_ACCOUNT
    : undefined;
  const { selection, env } = await resolveCredentialAccountEnvironment(provider, {
    preferred,
    preferredId: targetEnv.HAPPYHERD_PROVIDER_ACCOUNT_ID,
    paths: dependencies.paths,
  });
  if (selection.type === 'all-limited') {
    throw new Error(
      `All ${provider} accounts are limited until ${new Date(selection.limitedUntil).toISOString()}.`,
    );
  }
  if (selection.type === 'available') {
    for (const key of managedProviderDirectAuthKeys(provider)) delete targetEnv[key];
  }
  Object.assign(targetEnv, env);
  if (provider === 'codex' && selection.type === 'available' && selection.account.provider === 'codex') {
    await activateCodexCredential(selection.account, codexRuntimeHome(targetEnv));
  } else if (provider === 'grok' && selection.type === 'available' && selection.account.provider === 'grok') {
    await activateGrokCredential(selection.account, grokRuntimeHome(targetEnv));
  }
  return selection;
}
