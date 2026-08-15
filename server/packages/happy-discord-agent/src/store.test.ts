import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeStore } from './store';
import type { NormalizedDiscordMessage, SurfaceBinding } from './types';

const directories: string[] = [];

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pmai-bridge-store-'));
  directories.push(directory);
  return directory;
}

function message(id = 'message-1'): NormalizedDiscordMessage {
  return {
    sourceMessageId: id,
    authorDiscordId: 'discord-user-1',
    channelId: 'dm-channel-1',
    parentChannelId: null,
    guildId: null,
    threadId: null,
    surfaceKind: 'dm',
    surfaceKey: 'dm:discord-user-1',
    content: 'hello',
    mentionsApplication: false,
    authorIsBot: false,
    createdAt: 1,
  };
}

function binding(overrides: Partial<SurfaceBinding> = {}): SurfaceBinding {
  return {
    surfaceKey: 'dm:discord-user-1',
    surfaceKind: 'dm',
    channelId: 'dm-channel-1',
    guildId: null,
    threadId: null,
    pmaiUserId: 'pmai-user-1',
    capabilityId: 'capability-1',
    happySessionId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('BridgeStore', () => {
  it('durably claims one inbound source id and reloads it without transcript content', async () => {
    const directory = await stateDirectory();
    const store = await BridgeStore.open(directory);
    expect((await store.claimInbound(message())).duplicate).toBe(false);
    expect((await store.claimInbound(message())).duplicate).toBe(true);
    await store.updateInbound('message-1', { status: 'turn-pending', happySessionId: 'session-1', baselineSequence: 4 });

    const reopened = await BridgeStore.open(directory);
    expect(reopened.getInbound('message-1')).toMatchObject({
      status: 'turn-pending',
      happySessionId: 'session-1',
      happyLocalId: 'discord:message-1',
    });
    const raw = await readFile(join(directory, 'bridge-state.json'), 'utf8');
    expect(raw).not.toContain('hello');
    expect((await stat(join(directory, 'bridge-state.json'))).mode & 0o077).toBe(0);
  });

  it('keeps a DM bound to one PMAI actor and one capability', async () => {
    const store = await BridgeStore.open(await stateDirectory());
    await store.bindSurface(binding());
    const updated = await store.bindSurface(binding({ happySessionId: 'session-1', capabilityId: 'attacker-capability' }));
    expect(updated.capabilityId).toBe('capability-1');
    expect(updated.happySessionId).toBe('session-1');
    await expect(store.bindSurface(binding({ pmaiUserId: 'pmai-user-2' })))
      .rejects.toThrow('cannot change its linked PMAI actor');
  });

  it('lists only nonterminal records for restart recovery', async () => {
    const store = await BridgeStore.open(await stateDirectory());
    await store.claimInbound(message('pending'));
    await store.claimInbound(message('done'));
    await store.updateInbound('done', { status: 'delivered' });
    expect(store.listRecoverable().map((record) => record.sourceMessageId)).toEqual(['pending']);
  });
});
