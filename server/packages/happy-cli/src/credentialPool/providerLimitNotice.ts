import { notifyDaemonProviderLimited } from '@/daemon/controlClient';
import type { CredentialProvider } from './types';

export type ProviderLimitNotice = {
  sessionId: string;
  provider: CredentialProvider;
  account: string;
  limitedUntil: number;
};

const reported = new Set<string>();

export async function reportProviderHardLimitOnce(
  input: Omit<ProviderLimitNotice, 'account'> & { account?: string },
): Promise<boolean> {
  const account = input.account ?? process.env.HAPPYHERD_PROVIDER_ACCOUNT;
  const accountProvider = process.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE;
  if (!account || accountProvider !== input.provider) return false;
  const key = `${input.sessionId}:${input.provider}:${account}`;
  if (reported.has(key)) return false;
  reported.add(key);
  const result = await notifyDaemonProviderLimited({ ...input, account });
  if (result?.error) {
    reported.delete(key);
    return false;
  }
  return true;
}

export function resetProviderLimitNoticeForTests(): void {
  reported.clear();
}
