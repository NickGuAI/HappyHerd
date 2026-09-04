import {
  markCredentialAccountLimited,
  selectCredentialAccount,
  type CredentialPoolPaths,
} from './store';
import type { ProviderLimitNotice } from './providerLimitNotice';
import type { CredentialProvider } from './types';

export type ManagedProviderLimitNotice = ProviderLimitNotice & {
  provider: CredentialProvider;
  account: string;
};

export type ProviderLimitRotationDependencies = {
  paths?: CredentialPoolPaths;
  now?: () => number;
  stopProvider: (sessionId: string) => Promise<void>;
  resumeProvider: (sessionId: string) => Promise<string>;
  onAccountSwitched?: (switchEvent: {
    sessionId: string;
    provider: CredentialProvider;
    fromAccount: string;
    toAccount: string;
  }) => Promise<void>;
  onNoUsableAccount?: () => Promise<void>;
  waitUntil?: (timestamp: number) => Promise<void>;
};

export type ProviderLimitRotationResult =
  | { type: 'ignored' }
  | { type: 'unchanged'; account: string }
  | { type: 'rotated'; account: string }
  | { type: 'waited-and-rotated'; account: string };

const defaultWaitUntil = async (timestamp: number): Promise<void> => {
  const delay = Math.max(0, timestamp - Date.now());
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay);
    timer.unref?.();
  });
};

export async function rotateProviderSessionAfterLimit(
  notice: ManagedProviderLimitNotice,
  dependencies: ProviderLimitRotationDependencies,
): Promise<ProviderLimitRotationResult> {
  const now = dependencies.now ?? Date.now;
  const rotation = await markCredentialAccountLimited(
    notice.provider,
    notice.account,
    notice.limitedUntil,
    { paths: dependencies.paths, now: now() },
  );
  if (rotation.type === 'ignored') return { type: 'ignored' };

  if (rotation.type === 'all-limited') await dependencies.onNoUsableAccount?.();
  await dependencies.stopProvider(notice.sessionId);
  const resumeAndAnnounce = async (): Promise<{ account: string; switched: boolean }> => {
    const toAccount = await dependencies.resumeProvider(notice.sessionId);
    if (toAccount === notice.account) return { account: toAccount, switched: false };
    await dependencies.onAccountSwitched?.({
      sessionId: notice.sessionId,
      provider: notice.provider,
      fromAccount: notice.account,
      toAccount,
    });
    return { account: toAccount, switched: true };
  };
  if (rotation.type === 'next-account') {
    const resumed = await resumeAndAnnounce();
    return resumed.switched
      ? { type: 'rotated', account: resumed.account }
      : { type: 'unchanged', account: resumed.account };
  }

  const waitUntil = dependencies.waitUntil ?? defaultWaitUntil;
  let limitedUntil = rotation.limitedUntil;
  while (true) {
    await waitUntil(limitedUntil);
    const selection = await selectCredentialAccount(notice.provider, {
      paths: dependencies.paths,
      now: now(),
    });
    if (selection.type === 'available') {
      const resumed = await resumeAndAnnounce();
      return resumed.switched
        ? { type: 'waited-and-rotated', account: resumed.account }
        : { type: 'unchanged', account: resumed.account };
    }
    if (selection.type === 'unconfigured') return { type: 'ignored' };
    limitedUntil = selection.limitedUntil;
  }
}
