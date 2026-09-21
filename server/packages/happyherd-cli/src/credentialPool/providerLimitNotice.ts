import { notifyDaemonProviderLimited } from '@/daemon/controlClient';
import type { ProviderLimitProvider } from './providerLimits';

export type ProviderLimitNotice = {
  sessionId: string;
  provider: ProviderLimitProvider;
  account?: string;
  accountId?: string;
  credentialVersion?: number;
  limitedUntil: number;
};

// Keep the actual receipt in flight: a concurrent caller must not infer
// acceptance merely because another caller has started reporting.
const reported = new Map<string, Promise<boolean>>();

export async function reportProviderHardLimitOnce(
  input: ProviderLimitNotice,
): Promise<boolean> {
  const accountProvider = process.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE;
  const account = input.account
    ?? (accountProvider === input.provider ? process.env.HAPPYHERD_PROVIDER_ACCOUNT : undefined);
  const accountId = input.accountId
    ?? (accountProvider === input.provider ? process.env.HAPPYHERD_PROVIDER_ACCOUNT_ID : undefined);
  const rawCredentialVersion = accountProvider === input.provider
    ? process.env.HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION
    : undefined;
  const credentialVersion = input.credentialVersion
    ?? (rawCredentialVersion && Number.isInteger(Number(rawCredentialVersion))
      ? Number(rawCredentialVersion)
      : undefined);
  const key = `${input.sessionId}:${input.provider}:${accountId ?? account ?? 'unmanaged'}:${credentialVersion ?? 'legacy'}`;
  const existing = reported.get(key);
  if (existing) return existing;
  const delivery = (async (): Promise<boolean> => {
    try {
      const result = await notifyDaemonProviderLimited({
        ...input,
        ...(account ? { account } : {}),
        ...(accountId ? { accountId } : {}),
        ...(credentialVersion !== undefined ? { credentialVersion } : {}),
      });
      return !result?.error && result?.status === 'scheduled';
    } catch {
      return false;
    }
  })();
  reported.set(key, delivery);
  const accepted = await delivery;
  if (!accepted && reported.get(key) === delivery) reported.delete(key);
  return accepted;
}

export function resetProviderLimitNoticeForTests(): void {
  reported.clear();
}
