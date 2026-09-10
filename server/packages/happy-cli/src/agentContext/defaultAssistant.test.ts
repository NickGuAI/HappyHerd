import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'happyherd-default-commander-'));
  vi.stubEnv('HAPPY_HOME_DIR', directory);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

describe('default Assistant Commander', () => {
  it('creates a canonical definition once with ordinary memory files', async () => {
    const { ensureDefaultAssistantCommander } = await import('./defaultAssistant');
    const first = await ensureDefaultAssistantCommander();
    const original = await readFile(first.commanderPath, 'utf8');
    expect(first).toMatchObject({ id: 'happyherd-assistant', name: 'HappyHerd Assistant', workspace: os.homedir() });
    expect(await ensureDefaultAssistantCommander()).toEqual(first);
    expect(await readFile(first.commanderPath, 'utf8')).toBe(original);
    expect(await readFile(path.join(first.agentContextPath, 'memory', '1-working-memory.md'), 'utf8')).toBe('');
  });

  it.each(['happyherd-assistant', 'owner-assistant-id'])('preserves a custom existing definition (%s)', async (id) => {
    const { createCommanderFromManifest } = await import('@/commands/commander');
    const { defaultAssistantCommanderMarkdown } = await import('./defaultAssistantTemplate');
    const identity = { id, name: 'HappyHerd Assistant', role: 'Custom owner role', workspace: os.homedir() };
    const markdown = `${defaultAssistantCommanderMarkdown(identity)}\nOwner-authored instructions remain byte-faithful.\n`;
    await createCommanderFromManifest({ ...identity, commanderMarkdown: markdown, workingMemoryMarkdown: 'Existing memory' });
    const { ensureDefaultAssistantCommander } = await import('./defaultAssistant');
    const reused = await ensureDefaultAssistantCommander();
    expect(reused.id).toBe(id);
    expect(await readFile(reused.commanderPath, 'utf8')).toBe(markdown);
    expect(await readFile(path.join(reused.agentContextPath, 'memory', '1-working-memory.md'), 'utf8')).toBe('Existing memory');
  });
});
