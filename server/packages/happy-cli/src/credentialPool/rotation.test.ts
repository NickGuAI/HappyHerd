import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rotateProviderSessionAfterLimit } from './rotation';
import { upsertCredentialAccount, type CredentialPoolPaths } from './store';

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
    const stopProvider = vi.fn(async () => {});
    const resumeProvider = vi.fn(async () => {});
    const result = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-1', provider: 'codex', account: 'one', limitedUntil: 500,
    }, { paths, now: () => now, stopProvider, resumeProvider });

    expect(result).toEqual({ type: 'rotated', account: 'two' });
    expect(stopProvider).toHaveBeenCalledWith('happy-session-1');
    expect(resumeProvider).toHaveBeenCalledWith('happy-session-1');
  });

  it('stops, waits for the first reset, then resumes the same session when all accounts are limited', async () => {
    const stopProvider = vi.fn(async () => {});
    const resumeProvider = vi.fn(async () => {});
    await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-2', provider: 'codex', account: 'one', limitedUntil: 500,
    }, { paths, now: () => now, stopProvider, resumeProvider });
    const waitUntil = vi.fn(async (timestamp: number) => { now = timestamp; });

    const result = await rotateProviderSessionAfterLimit({
      sessionId: 'happy-session-2', provider: 'codex', account: 'two', limitedUntil: 700,
    }, { paths, now: () => now, stopProvider, resumeProvider, waitUntil });

    expect(waitUntil).toHaveBeenCalledWith(500);
    expect(result).toEqual({ type: 'waited-and-rotated', account: 'one' });
    expect(stopProvider).toHaveBeenLastCalledWith('happy-session-2');
    expect(resumeProvider).toHaveBeenLastCalledWith('happy-session-2');
  });
});
