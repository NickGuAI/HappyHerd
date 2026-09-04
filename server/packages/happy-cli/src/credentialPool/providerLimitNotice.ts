import { notifyDaemonProviderLimited } from '@/daemon/controlClient';
import type { ProviderLimitProvider } from './providerLimits';

export type ProviderLimitNotice = {
  sessionId: string;
  provider: ProviderLimitProvider;
  account?: string;
  limitedUntil: number;
};

const reported = new Set<string>();

export async function reportProviderHardLimitOnce(
  input: ProviderLimitNotice,
): Promise<boolean> {
  const accountProvider = process.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE;
  const account = input.account
    ?? (accountProvider === input.provider ? process.env.HAPPYHERD_PROVIDER_ACCOUNT : undefined);
  const key = `${input.sessionId}:${input.provider}:${account ?? 'unmanaged'}`;
  if (reported.has(key)) return true;
  reported.add(key);
  try {
    const result = await notifyDaemonProviderLimited({ ...input, ...(account ? { account } : {}) });
    if (!result?.error) return true;
    reported.delete(key);
    return false;
  } catch {
    reported.delete(key);
    return false;
  }
}

export function resetProviderLimitNoticeForTests(): void {
  reported.clear();
}
