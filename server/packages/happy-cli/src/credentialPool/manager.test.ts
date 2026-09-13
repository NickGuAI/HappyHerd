import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialAccountManager } from './manager';
import { readCredentialPoolState, upsertCredentialAccount, type CredentialPoolPaths } from './store';

function fakeLogin() {
  return {
    start: vi.fn(),
    status: vi.fn(),
    submitCode: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(async () => {}),
    withTargetReservations: vi.fn(async (_targets, operation) => operation()),
  };
}

describe('credential account manager', () => {
  let root: string;
  let paths: CredentialPoolPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-credential-manager-'));
    paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns secret-free stable identities and rejects stale row mutations', async () => {
    const account = await upsertCredentialAccount({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token: 'private-token' },
    }, { paths, now: 1 });
    const manager = new CredentialAccountManager({ paths, login: fakeLogin() as any });

    const summaries = await manager.listAccounts();
    expect(summaries).toEqual([expect.objectContaining({
      id: account.id,
      name: 'work',
      credentialVersion: account.credentialVersion,
      current: true,
    })]);
    expect(JSON.stringify(summaries)).not.toContain('private-token');

    await expect(manager.rename({
      id: account.id,
      provider: 'claude',
      name: 'work',
      newName: 'personal',
      expectedCredentialVersion: account.credentialVersion + 1,
    })).rejects.toThrow('changed');
    expect((await readCredentialPoolState(paths)).accounts[0].name).toBe('work');
  });

  it('blocks destructive changes for legacy live sessions while still allowing default selection', async () => {
    const first = await upsertCredentialAccount({
      provider: 'claude',
      name: 'work',
      credential: { type: 'oauth-token', token: 'work-token' },
    }, { paths, now: 1 });
    const second = await upsertCredentialAccount({
      provider: 'claude',
      name: 'personal',
      credential: { type: 'oauth-token', token: 'personal-token' },
    }, { paths, now: 2 });
    const login = fakeLogin();
    const manager = new CredentialAccountManager({
      paths,
      login: login as any,
      isLegacyAccountInUse: ({ id }) => id === first.id,
    });
    const work = {
      id: first.id,
      provider: 'claude' as const,
      name: first.name,
      expectedCredentialVersion: first.credentialVersion,
    };

    await expect(manager.use({
      id: second.id,
      provider: 'claude',
      name: second.name,
      expectedCredentialVersion: second.credentialVersion,
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: second.id, current: true }),
    ]));
    await expect(manager.rename({ ...work, newName: 'renamed' })).rejects.toThrow('before credential management');
    await expect(manager.remove(work)).rejects.toThrow('before credential management');
    await expect(manager.startLogin(work)).rejects.toThrow('before credential management');
    expect(login.start).not.toHaveBeenCalled();
  });

  it('passes the exact identity and revision into an existing-account relogin', async () => {
    const account = await upsertCredentialAccount({
      provider: 'grok',
      name: 'work',
      credential: { type: 'auth-file', path: join(root, 'work', 'auth.json') },
    }, { paths, now: 1 });
    const login = fakeLogin();
    login.start.mockResolvedValue({ id: 'flow' });
    const manager = new CredentialAccountManager({ paths, login: login as any });

    await manager.startLogin({
      id: account.id,
      provider: 'grok',
      name: account.name,
      expectedCredentialVersion: account.credentialVersion,
    });

    expect(login.start).toHaveBeenCalledExactlyOnceWith('grok', 'work', {
      type: 'existing',
      id: account.id,
      credentialVersion: account.credentialVersion,
    });
  });
});
