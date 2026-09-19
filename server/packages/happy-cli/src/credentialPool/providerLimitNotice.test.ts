import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyDaemonProviderLimited } from '@/daemon/controlClient';
import {
  reportProviderHardLimitOnce,
  resetProviderLimitNoticeForTests,
} from './providerLimitNotice';

vi.mock('@/daemon/controlClient', () => ({
  notifyDaemonProviderLimited: vi.fn(),
}));

describe('provider hard-limit daemon notices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderLimitNoticeForTests();
    vi.mocked(notifyDaemonProviderLimited).mockResolvedValue({ status: 'scheduled' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['claude', 'codex', 'grok', 'dsh'] as const)(
    'reports an unmanaged %s quota without inventing a credential-pool account',
    async (provider) => {
      await expect(reportProviderHardLimitOnce({
        sessionId: `${provider}-session`,
        provider,
        limitedUntil: 1234,
      })).resolves.toBe(true);

      expect(notifyDaemonProviderLimited).toHaveBeenCalledWith({
        sessionId: `${provider}-session`,
        provider,
        limitedUntil: 1234,
      });
    },
  );

  it('preserves a matching managed account for automatic rotation', async () => {
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'codex');
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'work-primary');
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', '00000000-0000-4000-8000-000000000001');
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', '3');

    await expect(reportProviderHardLimitOnce({
      sessionId: 'codex-session',
      provider: 'codex',
      limitedUntil: 5678,
    })).resolves.toBe(true);

    expect(notifyDaemonProviderLimited).toHaveBeenCalledWith({
      sessionId: 'codex-session',
      provider: 'codex',
      account: 'work-primary',
      accountId: '00000000-0000-4000-8000-000000000001',
      credentialVersion: 3,
      limitedUntil: 5678,
    });
  });

  it('deduplicates by stable account identity after a local rename', async () => {
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'grok');
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'renamed');
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', '00000000-0000-4000-8000-000000000002');
    vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', '2');

    await expect(reportProviderHardLimitOnce({
      sessionId: 'grok-session', provider: 'grok', account: 'old-name', limitedUntil: 9012,
    })).resolves.toBe(true);
    await expect(reportProviderHardLimitOnce({
      sessionId: 'grok-session', provider: 'grok', account: 'renamed', limitedUntil: 9012,
    })).resolves.toBe(true);

    expect(notifyDaemonProviderLimited).toHaveBeenCalledOnce();
    expect(notifyDaemonProviderLimited).toHaveBeenCalledWith(expect.objectContaining({
      accountId: '00000000-0000-4000-8000-000000000002',
      credentialVersion: 2,
    }));
  });

  it('delivers a new notice after the same account is relogged', async () => {
    const accountId = '00000000-0000-4000-8000-000000000003';
    await expect(reportProviderHardLimitOnce({
      sessionId: 'codex-relogged-session',
      provider: 'codex',
      account: 'work',
      accountId,
      credentialVersion: 1,
      limitedUntil: 9012,
    })).resolves.toBe(true);
    await expect(reportProviderHardLimitOnce({
      sessionId: 'codex-relogged-session',
      provider: 'codex',
      account: 'work',
      accountId,
      credentialVersion: 2,
      limitedUntil: 9012,
    })).resolves.toBe(true);

    expect(notifyDaemonProviderLimited).toHaveBeenCalledTimes(2);
  });

  it('retries a notice when the daemon ignores it as stale', async () => {
    const notice = {
      sessionId: 'codex-stale-session',
      provider: 'codex' as const,
      account: 'work',
      accountId: '00000000-0000-4000-8000-000000000004',
      credentialVersion: 1,
      limitedUntil: 9012,
    };
    vi.mocked(notifyDaemonProviderLimited)
      .mockResolvedValueOnce({ status: 'ignored' })
      .mockResolvedValueOnce({ status: 'scheduled' });

    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(false);
    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(true);
    expect(notifyDaemonProviderLimited).toHaveBeenCalledTimes(2);
  });

  it.each(['scheduled', 'ignored'] as const)(
    'shares the actual %s receipt with concurrent duplicate callers', async (status) => {
      let acknowledge!: (receipt: { status: 'scheduled' | 'ignored' }) => void;
      vi.mocked(notifyDaemonProviderLimited).mockReturnValueOnce(new Promise((resolve) => {
        acknowledge = resolve;
      }));
      const notice = { sessionId: 'concurrent', provider: 'grok' as const, limitedUntil: 1234 };
      const first = reportProviderHardLimitOnce(notice);
      let secondSettled = false;
      const second = reportProviderHardLimitOnce(notice).then((accepted) => {
        secondSettled = true;
        return accepted;
      });
      await Promise.resolve();
      expect(secondSettled).toBe(false);
      expect(notifyDaemonProviderLimited).toHaveBeenCalledOnce();
      acknowledge({ status });
      await expect(Promise.all([first, second])).resolves.toEqual([
        status === 'scheduled', status === 'scheduled',
      ]);
      await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(true);
      expect(notifyDaemonProviderLimited).toHaveBeenCalledTimes(status === 'scheduled' ? 1 : 2);
    },
  );

  it.each([{}, { error: 'delivery failed' }])('does not acknowledge an invalid receipt %j', async (receipt) => {
    vi.mocked(notifyDaemonProviderLimited).mockResolvedValueOnce(receipt);
    const notice = { sessionId: 'invalid-receipt', provider: 'codex' as const, limitedUntil: 1234 };
    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(false);
    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(true);
    expect(notifyDaemonProviderLimited).toHaveBeenCalledTimes(2);
  });

  it('keeps transport exceptions retryable', async () => {
    vi.mocked(notifyDaemonProviderLimited).mockRejectedValueOnce(new Error('disconnected'));
    const notice = { sessionId: 'transport-failure', provider: 'claude' as const, limitedUntil: 1234 };
    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(false);
    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(true);
    expect(notifyDaemonProviderLimited).toHaveBeenCalledTimes(2);
  });

  it('treats an accepted duplicate as already delivered without posting twice', async () => {
    const notice = {
      sessionId: 'claude-session',
      provider: 'claude' as const,
      limitedUntil: 9012,
    };

    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(true);
    await expect(reportProviderHardLimitOnce(notice)).resolves.toBe(true);
    expect(notifyDaemonProviderLimited).toHaveBeenCalledOnce();
  });
});
