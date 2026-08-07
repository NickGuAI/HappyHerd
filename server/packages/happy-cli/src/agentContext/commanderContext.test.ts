import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  contextEnvironment,
  assertReconnectContextMatchesEnvironment,
  instructionReceiptMetadata,
  listCommanders,
  mergeContextPrompt,
  parseCommanderIdentity,
  prepareCommanderContext,
} from './commanderContext';

let root: string;
const originalEnv = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-context-'));
  process.env.HAPPY_HOME_DIR = path.join(root, '.happyherd');
  await mkdir(process.env.HAPPY_HOME_DIR, { recursive: true });
  await writeFile(path.join(process.env.HAPPY_HOME_DIR, 'AGENTS.md'), '# Global\nAlways verify.\n');
  const commanderDir = path.join(process.env.HAPPY_HOME_DIR, 'commanders', 'athena');
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
    expect(result.globalAgentsPath).toBe(path.join(root, '.happyherd', 'AGENTS.md'));
  });

  it('does not load the retired singular Commander store', async () => {
    const legacyDir = path.join(root, '.happyherd', 'commander', 'gaia');
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
    expect(result.commanders.some((commander) => commander.id === 'gaia')).toBe(false);
    await expect(prepareCommanderContext('gaia')).rejects.toThrow('was not found');
  });

  it('keeps Commander path containment inside the canonical plural root', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'COMMANDER.md'), [
      'You are Escape, invalid commander.',
      `Workspace: \`${root}/workspace\``,
    ].join('\n'));
    const canonicalRoot = path.join(root, '.happyherd', 'commanders');
    await mkdir(canonicalRoot, { recursive: true });
    await symlink(outside, path.join(canonicalRoot, 'escape'));

    await expect(prepareCommanderContext('escape')).rejects.toThrow('escapes the configured AgentContext root');
  });

  it('creates an integrity-addressed bundle and a CLAUDE mirror', async () => {
    const projectDir = path.join(root, 'workspace');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'AGENTS.md'), '# Project\nUse project tests.\n');
    const bundle = await prepareCommanderContext('athena', projectDir);
    const content = await readFile(bundle.bundlePath, 'utf8');
    expect(content).toContain('Always verify.');
    expect(content).toContain('Ship verified work.');
    expect(content).toContain('Use project tests.');
    expect(bundle.projectGuidancePath).toBe(path.join(projectDir, 'AGENTS.md'));
    expect(await readFile(path.join(root, '.happyherd', 'CLAUDE.md'), 'utf8')).toContain('Always verify.');
    expect(contextEnvironment(bundle)).toMatchObject({
      HAPPYHERD_COMMANDER_ID: 'athena',
      HAPPYHERD_CONTEXT_HASH: bundle.contextHash,
    });
  });

  it('uses the actual session directory and never reloads the retired home guide', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), '# Retired Herd root\n');
    const projectDir = path.join(root, 'workspace', 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(root, 'workspace', 'AGENTS.md'), '# Closest project\n');

    const bundle = await prepareCommanderContext('athena', projectDir);
    const content = await readFile(bundle.bundlePath, 'utf8');

    expect(bundle.projectGuidancePath).toBe(path.join(root, 'workspace', 'AGENTS.md'));
    expect(content).toContain('Closest project');
    expect(content).not.toContain('Retired Herd root');
  });

  it('records a versioned digest of the instruction content delivered to a provider', () => {
    expect(instructionReceiptMetadata({
      provider: 'codex',
      layer: 'developer',
      deliveredInstruction: 'global + commander + project',
    })).toMatchObject({
      instructionReceiptVersion: 1,
      instructionProvider: 'codex',
      instructionLayer: 'developer',
      instructionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('never allows a per-message reset to remove Commander context', () => {
    expect(mergeContextPrompt('base', null)).toBe('base');
    expect(mergeContextPrompt('base', 'extra')).toContain('base');
    expect(mergeContextPrompt('base', 'extra')).toContain('extra');
  });

  it('fails closed when a reconnect loses or changes its instruction receipt', () => {
    process.env.HAPPY_RECONNECT_SESSION_ID = 'session-one';
    process.env.HAPPYHERD_CONTEXT_HASH = 'current-hash';
    expect(() => assertReconnectContextMatchesEnvironment()).toThrow(/changed since this session started/);
    expect(() => assertReconnectContextMatchesEnvironment('old-hash')).toThrow(/changed since this session started/);
    expect(() => assertReconnectContextMatchesEnvironment('current-hash')).not.toThrow();
  });
});
