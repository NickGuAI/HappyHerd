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
  resumeProvider: (sessionId: string) => Promise<void>;
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
  if (rotation.type === 'next-account') {
    await dependencies.resumeProvider(notice.sessionId);
    return { type: 'rotated', account: rotation.account.name };
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
      await dependencies.resumeProvider(notice.sessionId);
      return { type: 'waited-and-rotated', account: selection.account.name };
    }
    if (selection.type === 'unconfigured') return { type: 'ignored' };
    limitedUntil = selection.limitedUntil;
  }
}
