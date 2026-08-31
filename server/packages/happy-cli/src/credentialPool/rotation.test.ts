import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rotateProviderSessionAfterLimit } from './rotation';
import {
  markCredentialAccountLimited,
  upsertCredentialAccount,
  type CredentialPoolPaths,
} from './store';

describe('quota-triggered same-session rotation', () => {
  let root: string;
  let paths: CredentialPoolPaths;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-credential-rotation-'));
    paths = { stateFile: join(root, 'state.json'), accountsDir: join(root, 'accounts') };
    now = 100;
    await upsertCredentialAccount({
      provider: 'codex', name: 'one', credential: { type: 'auth-file', path: join(root, 'one', 'auth.json') },
    }, { paths, now: 1 });
    await upsertCredentialAccount({
      provider: 'codex', name: 'two', credential: { type: 'auth-file', path: join(root, 'two', 'auth.json') },
    }, { paths, now: 2 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stops and resumes the same Happy session on the next account', async () => {
    const calls: string[] = [];
    const stopProvider = vi.fn(async () => {});
    const resumeProvider = vi.fn(async () => { calls.push('resume'); return 'two'; });
    const onAccountSwitched = vi.fn(async () => { calls.push('announce'); });
    const result = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-1', provider: 'codex', account: 'one', limitedUntil: 500,
    }, { paths, now: () => now, stopProvider, resumeProvider, onAccountSwitched });

    expect(result).toEqual({ type: 'rotated', account: 'two' });
    expect(stopProvider).toHaveBeenCalledWith('happy-session-1');
    expect(resumeProvider).toHaveBeenCalledWith('happy-session-1');
    expect(onAccountSwitched).toHaveBeenCalledWith({
      sessionId: 'happy-session-1',
      provider: 'codex',
      fromAccount: 'one',
      toAccount: 'two',
    });
    expect(calls).toEqual(['resume', 'announce']);
  });

  it('stops, waits for the first reset, then resumes the same session when all accounts are limited', async () => {
    const stopProvider = vi.fn(async () => {});
    const resumeProvider = vi.fn()
      .mockResolvedValueOnce('two')
      .mockResolvedValueOnce('one');
    const onAccountSwitched = vi.fn(async () => {});
    await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-2', provider: 'codex', account: 'one', limitedUntil: 500,
    }, { paths, now: () => now, stopProvider, resumeProvider });
    const waitUntil = vi.fn(async (timestamp: number) => { now = timestamp; });

    const result = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-2', provider: 'codex', account: 'two', limitedUntil: 700,
    }, { paths, now: () => now, stopProvider, resumeProvider, onAccountSwitched, waitUntil });

    expect(waitUntil).toHaveBeenCalledWith(500);
    expect(result).toEqual({ type: 'waited-and-rotated', account: 'one' });
    expect(stopProvider).toHaveBeenLastCalledWith('happy-session-2');
    expect(resumeProvider).toHaveBeenLastCalledWith('happy-session-2');
    expect(onAccountSwitched).toHaveBeenCalledTimes(1);
    expect(onAccountSwitched).toHaveBeenCalledWith({
      sessionId: 'happy-session-2',
      provider: 'codex',
      fromAccount: 'two',
      toAccount: 'one',
    });
  });

  it('does not announce an ignored limit notice', async () => {
    const onAccountSwitched = vi.fn(async () => {});
    const ignored = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-ignored', provider: 'codex', account: 'missing', limitedUntil: 500,
    }, {
      paths,
      now: () => now,
      stopProvider: vi.fn(async () => {}),
      resumeProvider: vi.fn(async () => 'two'),
      onAccountSwitched,
    });
    expect(ignored).toEqual({ type: 'ignored' });
    expect(onAccountSwitched).not.toHaveBeenCalled();
  });

  it('does not announce when stopping the limited provider fails', async () => {
    const resumeProvider = vi.fn(async () => 'two');
    const onAccountSwitched = vi.fn(async () => {});
    await expect(rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-stop-failed', provider: 'codex', account: 'one', limitedUntil: 500,
    }, {
      paths,
      now: () => now,
      stopProvider: vi.fn(async () => { throw new Error('stop failed'); }),
      resumeProvider,
      onAccountSwitched,
    })).rejects.toThrow('stop failed');
    expect(resumeProvider).not.toHaveBeenCalled();
    expect(onAccountSwitched).not.toHaveBeenCalled();
  });

  it('does not announce when the replacement provider fails to resume', async () => {
    const onAccountSwitched = vi.fn(async () => {});
    await expect(rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-failed', provider: 'codex', account: 'one', limitedUntil: 500,
    }, {
      paths,
      now: () => now,
      stopProvider: vi.fn(async () => {}),
      resumeProvider: vi.fn(async () => { throw new Error('resume failed'); }),
      onAccountSwitched,
    })).rejects.toThrow('resume failed');
    expect(onAccountSwitched).not.toHaveBeenCalled();
  });

  it('does not announce when waiting resumes the same account', async () => {
    await markCredentialAccountLimited('codex', 'two', 700, { paths, now });
    const waitUntil = vi.fn(async (timestamp: number) => { now = timestamp; });
    const onAccountSwitched = vi.fn(async () => {});
    const sameAccount = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-same', provider: 'codex', account: 'one', limitedUntil: 500,
    }, {
      paths,
      now: () => now,
      stopProvider: vi.fn(async () => {}),
      resumeProvider: vi.fn(async () => 'one'),
      onAccountSwitched,
      waitUntil,
    });
    expect(sameAccount).toEqual({ type: 'waited-and-rotated', account: 'one' });
    expect(onAccountSwitched).not.toHaveBeenCalled();
  });

  it('announces the account reported by the resumed provider when selection changes during restart', async () => {
    await upsertCredentialAccount({
      provider: 'codex', name: 'three', credential: { type: 'auth-file', path: join(root, 'three', 'auth.json') },
    }, { paths, now: 3 });
    const onAccountSwitched = vi.fn(async () => {});

    const result = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-race', provider: 'codex', account: 'one', limitedUntil: 500,
    }, {
      paths,
      now: () => now,
      stopProvider: vi.fn(async () => {}),
      resumeProvider: vi.fn(async () => 'three'),
      onAccountSwitched,
    });

    expect(result).toEqual({ type: 'rotated', account: 'three' });
    expect(onAccountSwitched).toHaveBeenCalledWith({
      sessionId: 'happy-session-race',
      provider: 'codex',
      fromAccount: 'one',
      toAccount: 'three',
    });
  });
});
