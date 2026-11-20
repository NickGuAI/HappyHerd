import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderAccountWaits, type ProviderAccountWait } from './providerAccountWaits';
import type { CredentialPoolSelection } from '@/credentialPool/types';
import { CredentialAccountManager } from '@/credentialPool/manager';
import { selectCredentialAccount, upsertCredentialAccount } from '@/credentialPool/store';

const incident: ProviderAccountWait = {
  sessionId: 'session', provider: 'claude', accountId: 'account-id', account: 'one',
  incidentId: 'incident', limitedUntil: 1_000,
};

describe('durable provider account waits', () => {
  let root: string;
  let available: boolean;
  let archived: boolean;
  let accepted: string[];
  let owners: ProviderAccountWaits[];
  const selection = (): CredentialPoolSelection => available
    ? { type: 'available', account: {} as never }
    : { type: 'all-limited', limitedUntil: 1_000 };
  const create = () => {
    const owner = new ProviderAccountWaits(join(root, 'waits.json'), {
      isStored: () => true,
      select: async () => selection(),
      recover: async (wait, current) => {
        if (!current()) return 'failed';
        if (archived) return 'archived';
        const id = `${wait.incidentId}-continue`;
        if (!accepted.includes(id)) accepted.push(id);
        return 'accepted';
      },
      onError: (error) => { throw error; },
    });
    owners.push(owner);
    return owner;
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'account-waits-'));
    available = false;
    archived = false;
    accepted = [];
    owners = [];
    vi.useFakeTimers();
    vi.setSystemTime(100);
  });
  afterEach(async () => {
    owners.forEach((owner) => owner.dispose());
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it.each([false, true])('continues once when the time passes, restart=%s', async (restart) => {
    let owner = create();
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    if (restart) { owner.dispose(); owner = create(); owner.start(); await vi.advanceTimersByTimeAsync(0); }
    available = true;
    await vi.advanceTimersByTimeAsync(900);
    expect(accepted).toEqual(['incident-continue']);
  });

  it.each([false, true])('continues immediately on reset, restart=%s', async (restart) => {
    let owner = create();
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    if (restart) { owner.dispose(); owner = create(); owner.start(); await vi.advanceTimersByTimeAsync(0); }
    available = true;
    owner.changed('claude');
    owner.changed('claude');
    await vi.advanceTimersByTimeAsync(0);
    expect(accepted).toEqual(['incident-continue']);
    await vi.advanceTimersByTimeAsync(900);
    expect(accepted).toEqual(['incident-continue']);
  });

  it.each(['stop', 'resume', 'message'])('cancels on user %s', async () => {
    const owner = create();
    owner.add(incident);
    owner.stopped('session');
    expect(owner.cancel('session')).toBe(true);
    available = true;
    owner.changed('claude');
    await vi.advanceTimersByTimeAsync(900);
    expect(accepted).toEqual([]);
  });

  it('drops an archived session without sending', async () => {
    const owner = create();
    owner.add(incident);
    owner.stopped('session');
    archived = true;
    available = true;
    owner.changed('claude');
    await vi.advanceTimersByTimeAsync(0);
    expect(accepted).toEqual([]);
    expect(owner.cancel('session')).toBe(false);
  });

  it('accepts a new incident after another limit', async () => {
    const owner = create();
    owner.add(incident);
    owner.stopped('session');
    available = true;
    await owner.look('session');
    owner.add({ ...incident, incidentId: 'next-incident' });
    owner.stopped('session');
    await owner.look('session');
    expect(accepted).toEqual(['incident-continue', 'next-incident-continue']);
  });

  it('tries a failed recovery again after one minute', async () => {
    const recover = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('accepted');
    const owner = new ProviderAccountWaits(join(root, 'waits.json'), {
      isStored: () => true,
      select: async () => ({ type: 'available', account: {} as never }),
      recover,
      onError: (error) => { throw error; },
    });
    owners.push(owner);
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(owner.has('session')).toBe(false);
  });

  it('deletes a missing local session at the first look without a timer', async () => {
    const select = vi.fn(async () => ({ type: 'all-limited' as const, limitedUntil: 100_000 }));
    const recover = vi.fn();
    const owner = new ProviderAccountWaits(join(root, 'waits.json'), {
      isStored: () => false,
      select,
      recover,
      onError: (error) => { throw error; },
    });
    owners.push(owner);
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.has('session')).toBe(false);
    expect(create().has('session')).toBe(false);
    expect(select).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a temporary local store read failure after one minute', async () => {
    const isStored = vi.fn().mockImplementationOnce(() => { throw new Error('temporary read error'); }).mockReturnValue(false);
    const owner = new ProviderAccountWaits(join(root, 'waits.json'), {
      isStored,
      select: async () => ({ type: 'unconfigured' }),
      recover: async () => 'accepted',
      onError: vi.fn(),
    });
    owners.push(owner);
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.has('session')).toBe(true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(isStored).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(isStored).toHaveBeenCalledTimes(2);
    expect(owner.has('session')).toBe(false);
  });

  it('retries a failed account selection after one minute', async () => {
    const select = vi.fn().mockRejectedValueOnce(new Error('temporary store error'))
      .mockResolvedValueOnce({ type: 'available', account: {} as never });
    const recover = vi.fn(async () => 'accepted' as const);
    const onError = vi.fn();
    const owner = new ProviderAccountWaits(join(root, 'waits.json'), { isStored: () => true, select, recover, onError });
    owners.push(owner);
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(select).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledOnce();
    expect(owner.has('session')).toBe(false);
  });

  it('removes the wait when there are no configured accounts', async () => {
    const recover = vi.fn();
    const owner = new ProviderAccountWaits(join(root, 'waits.json'), {
      isStored: () => true,
      select: async () => ({ type: 'unconfigured' }),
      recover,
      onError: (error) => { throw error; },
    });
    owners.push(owner);
    owner.add(incident);
    owner.stopped('session');
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.has('session')).toBe(false);
    expect(recover).not.toHaveBeenCalled();
    expect(create().has('session')).toBe(false);
  });

  it('wakes from a successful reset in the real temporary account store after restart', async () => {
    const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
    const account = await upsertCredentialAccount({
      provider: 'claude', name: 'one', credential: { type: 'oauth-token', token: 'synthetic-token' },
      limitedUntil: 10_000,
    }, { paths, now: 1 });
    const recover = vi.fn(async (wait: ProviderAccountWait) => {
      accepted.push(`${wait.incidentId}-continue`);
      return 'accepted' as const;
    });
    const createReal = () => {
      const owner = new ProviderAccountWaits(join(root, 'waits.json'), {
        isStored: () => true,
        select: (provider) => selectCredentialAccount(provider, { paths }),
        recover,
        onError: (error) => { throw error; },
      });
      owners.push(owner);
      return owner;
    };
    const first = createReal();
    first.add(incident);
    first.dispose();
    const restored = createReal();
    const login = { withTargetReservations: async (_targets: unknown, fn: () => Promise<unknown>) => fn() };
    const manager = new CredentialAccountManager({ paths, login: login as never, onCooldownReset: (provider) => restored.changed(provider) });
    await manager.resetCooldown({ provider: 'claude', name: 'one', id: account.id, expectedCredentialVersion: account.credentialVersion });
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    expect(accepted).toEqual(['incident-continue']);
  });
});
