import {
  markCredentialAccountLimited,
  selectCredentialAccount,
  type CredentialPoolPaths,
} from './store';
import type { ProviderLimitNotice } from './providerLimitNotice';

export type ProviderLimitRotationDependencies = {
  paths?: CredentialPoolPaths;
  now?: () => number;
  stopProvider: (sessionId: string) => Promise<void>;
  resumeProvider: (sessionId: string) => Promise<string>;
  onAccountSwitched?: (switchEvent: {
    sessionId: string;
    provider: ProviderLimitNotice['provider'];
    fromAccount: string;
    toAccount: string;
  }) => Promise<void>;
  waitUntil?: (timestamp: number) => Promise<void>;
};

export type ProviderLimitRotationResult =
  | { type: 'ignored' }
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
  notice: ProviderLimitNotice,
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

  await dependencies.stopProvider(notice.sessionId);
  const resumeAndAnnounce = async (): Promise<string> => {
    const toAccount = await dependencies.resumeProvider(notice.sessionId);
    if (toAccount === notice.account) return toAccount;
    await dependencies.onAccountSwitched?.({
      sessionId: notice.sessionId,
      provider: notice.provider,
      fromAccount: notice.account,
      toAccount,
    });
    return toAccount;
  };
  if (rotation.type === 'next-account') {
    const account = await resumeAndAnnounce();
    return { type: 'rotated', account };
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
      const account = await resumeAndAnnounce();
      return { type: 'waited-and-rotated', account };
    }
    if (selection.type === 'unconfigured') return { type: 'ignored' };
    limitedUntil = selection.limitedUntil;
  }
}
