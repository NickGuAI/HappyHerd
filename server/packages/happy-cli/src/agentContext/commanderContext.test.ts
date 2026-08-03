import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  contextEnvironment,
  listCommanders,
  mergeContextPrompt,
  parseCommanderIdentity,
  prepareCommanderContext,
} from './commanderContext';

let root: string;
const originalEnv = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-context-'));
  process.env.HAPPYHERD_HOME_DIR = root;
  process.env.HAPPYHERD_AGENTCONTEXT_ROOT = path.join(root, '.herd');
  process.env.HAPPYHERD_AGENTS_FILE = path.join(root, 'AGENTS.md');
  process.env.HAPPYHERD_CLAUDE_FILE = path.join(root, 'CLAUDE.md');
  process.env.HAPPY_HOME_DIR = path.join(root, '.happy');
  await writeFile(path.join(root, 'AGENTS.md'), '# Global\nAlways verify.\n');
  const commanderDir = path.join(root, '.herd', 'commanders', 'athena');
  await mkdir(path.join(commanderDir, 'agentcontext'), { recursive: true });
  await writeFile(path.join(commanderDir, 'COMMANDER.md'), [
    '---',
    'identity_and_scope:',
    '  name: Athena',
    '  commander_id: athena',
    `  workspace: ${root}/workspace`,
    '  role: Engineering commander',
    '---',
    '# Mission',
    'Ship verified work.',
  ].join('\n'));
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Commander context', () => {
  it('parses the supported identity fields only', () => {
    expect(parseCommanderIdentity('---\nidentity_and_scope:\n  name: Athena\n  commander_id: a\n  workspace: /x\n---\n')).toEqual({
      name: 'Athena', commanderId: 'a', workspace: '/x',
    });
  });

  it('lists valid commanders and their existing paths', async () => {
    const result = await listCommanders();
    expect(result.commanders).toHaveLength(1);
    expect(result.commanders[0]).toMatchObject({ id: 'athena', name: 'Athena' });
    expect(result.globalAgentsPath).toBe(path.join(root, 'AGENTS.md'));
  });

  it('discovers established singular-store prose Commanders without relocating their files', async () => {
    const legacyDir = path.join(root, '.herd', 'commander', 'gaia');
    await mkdir(path.join(legacyDir, '.memory'), { recursive: true });
    await writeFile(path.join(legacyDir, 'COMMANDER.md'), [
      'Global runtime defaults live elsewhere.',
      '',
      'You are Gaia, onboarding commander for Gehirn.',
      `Workspace: \`${root}/legacy-workspace\``,
      '',
      '## Memory',
      'Keep the existing .memory tree.',
    ].join('\n'));

    const result = await listCommanders();
    const gaia = result.commanders.find((commander) => commander.id === 'gaia');
    expect(gaia).toMatchObject({
      id: 'gaia',
      name: 'Gaia',
      role: 'onboarding commander for Gehirn',
      workspace: path.join(root, 'legacy-workspace'),
      commanderPath: path.join(legacyDir, 'COMMANDER.md'),
      agentContextPath: legacyDir,
    });

    const bundle = await prepareCommanderContext('gaia');
    expect(await readFile(bundle.bundlePath, 'utf8')).toContain('Keep the existing .memory tree.');
    expect(bundle.commander?.agentContextPath).toBe(legacyDir);
  });

  it('prefers a canonical plural-store Commander when both layouts contain the same id', async () => {
    const duplicate = path.join(root, '.herd', 'commander', 'athena');
    await mkdir(duplicate, { recursive: true });
    await writeFile(path.join(duplicate, 'COMMANDER.md'), [
      'You are Legacy Athena, obsolete duplicate.',
      `Workspace: \`${root}/legacy-workspace\``,
    ].join('\n'));

    const result = await listCommanders();
    const matches = result.commanders.filter((commander) => commander.id === 'athena');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      name: 'Athena',
      commanderPath: path.join(root, '.herd', 'commanders', 'athena', 'COMMANDER.md'),
    });
  });

  it('keeps path containment independent for the legacy root', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'COMMANDER.md'), [
      'You are Escape, invalid commander.',
      `Workspace: \`${root}/workspace\``,
    ].join('\n'));
    const legacyRoot = path.join(root, '.herd', 'commander');
    await mkdir(legacyRoot, { recursive: true });
    await symlink(outside, path.join(legacyRoot, 'escape'));

    await expect(prepareCommanderContext('escape')).rejects.toThrow('escapes the configured AgentContext root');
  });

  it('creates an integrity-addressed bundle and a CLAUDE mirror', async () => {
    const bundle = await prepareCommanderContext('athena');
    const content = await readFile(bundle.bundlePath, 'utf8');
    expect(content).toContain('Always verify.');
    expect(content).toContain('Ship verified work.');
    expect(await readFile(path.join(root, 'CLAUDE.md'), 'utf8')).toContain('Always verify.');
    expect(contextEnvironment(bundle)).toMatchObject({
      HAPPYHERD_COMMANDER_ID: 'athena',
      HAPPYHERD_CONTEXT_HASH: bundle.contextHash,
    });
  });

  it('never allows a per-message reset to remove Commander context', () => {
    expect(mergeContextPrompt('base', null)).toBe('base');
    expect(mergeContextPrompt('base', 'extra')).toContain('base');
    expect(mergeContextPrompt('base', 'extra')).toContain('extra');
  });
});
