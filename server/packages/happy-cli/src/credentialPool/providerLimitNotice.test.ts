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

    await expect(reportProviderHardLimitOnce({
      sessionId: 'codex-session',
      provider: 'codex',
      limitedUntil: 5678,
    })).resolves.toBe(true);

    expect(notifyDaemonProviderLimited).toHaveBeenCalledWith({
      sessionId: 'codex-session',
      provider: 'codex',
      account: 'work-primary',
      limitedUntil: 5678,
    });
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
