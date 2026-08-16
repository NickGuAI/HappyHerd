import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  contextEnvironment,
  instructionReceiptMetadata,
  listCommanders,
  mergeContextPrompt,
  parseCommanderIdentity,
  prepareCommanderContext,
  readContextPromptFromEnvironment,
} from './commanderContext';

let root: string;
const originalEnv = { ...process.env };
const originalTmpDir = os.tmpdir();

beforeEach(async () => {
  root = await mkdtemp(path.join(originalTmpDir, 'happyherd-context-'));
  process.env.TMPDIR = path.join(root, 'tmp');
  await mkdir(process.env.TMPDIR, { recursive: true });
  process.env.HAPPY_HOME_DIR = path.join(root, '.happyherd');
  await mkdir(process.env.HAPPY_HOME_DIR, { recursive: true });
  await writeFile(path.join(process.env.HAPPY_HOME_DIR, 'AGENTS.md'), '# Global\nAlways verify.\n');
  const commanderDir = path.join(process.env.HAPPY_HOME_DIR, 'commanders', 'athena');
  const memoryDir = path.join(commanderDir, 'agentcontext', 'memory');
  await mkdir(memoryDir, { recursive: true });
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
  await writeFile(path.join(memoryDir, '0-observations.jsonl'), '{"private":"L1 evidence stays on demand"}\n');
  await writeFile(path.join(memoryDir, '1-working-memory.md'), '# Current lane\nFinish the runtime repair.\n');
  await writeFile(path.join(memoryDir, '2-long-term-memory.md'), '# Durable constraints\nVerify before delivery.\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
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
      'You are Gaia, onboarding commander for Example Org.',
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

  it('creates a transient integrity-addressed prompt and a CLAUDE mirror', async () => {
    const projectDir = path.join(root, 'workspace');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'AGENTS.md'), '# Project\nUse project tests.\n');
    const bundle = await prepareCommanderContext('athena', projectDir);
    const content = await readFile(bundle.bundlePath, 'utf8');
    expect(content).toContain('Always verify.');
    expect(content).toContain('Ship verified work.');
    expect(content).toContain('Finish the runtime repair.');
    expect(content).toContain('Verify before delivery.');
    expect(content).toContain(`Source: ${path.join(root, '.happyherd', 'commanders', 'athena', 'agentcontext', 'memory', '1-working-memory.md')}`);
    expect(content).toContain('Commander memory auto-load limit: 65536 bytes per file');
    expect(content).toContain('Commander L1 observations: on demand (not included)');
    expect(content).not.toContain('L1 evidence stays on demand');
    expect(content).toContain('Use project tests.');
    expect(bundle.projectGuidancePath).toBe(path.join(projectDir, 'AGENTS.md'));
    expect(await readFile(path.join(root, '.happyherd', 'CLAUDE.md'), 'utf8')).toContain('Always verify.');
    expect(contextEnvironment(bundle)).toMatchObject({
      HAPPYHERD_COMMANDER_ID: 'athena',
      HAPPYHERD_CONTEXT_BUNDLE_PATH: bundle.bundlePath,
      HAPPYHERD_CONTEXT_HASH: bundle.contextHash,
    });
    Object.assign(process.env, contextEnvironment(bundle));
    expect(await readContextPromptFromEnvironment()).toBe(content);
    await expect(access(bundle.bundlePath)).rejects.toThrow();
    await expect(access(path.join(root, '.happyherd', 'agent-context'))).rejects.toThrow();
  });

  it('bounds each automatically loaded memory file without breaking UTF-8', async () => {
    const workingMemoryPath = path.join(
      root,
      '.happyherd',
      'commanders',
      'athena',
      'agentcontext',
      'memory',
      '1-working-memory.md',
    );
    await writeFile(workingMemoryPath, `# Oversized\n${'界'.repeat(30_000)}\nMEMORY_END_MARKER\n`);

    const bundle = await prepareCommanderContext('athena');
    const content = await readFile(bundle.bundlePath, 'utf8');

    expect(content).toContain('Commander L2 working memory:');
    expect(content).toContain('; truncated)');
    expect(content).toContain('Truncated: yes');
    expect(content).not.toContain('MEMORY_END_MARKER');
    expect(content).not.toContain('\uFFFD');
  });

  it('repairs a divergent CLAUDE mirror without blocking Commander session preparation', async () => {
    const mirrorPath = path.join(root, '.happyherd', 'CLAUDE.md');
    await writeFile(mirrorPath, '# Stale instructions\nDo not use this copy.\n');

    await expect(prepareCommanderContext('athena')).resolves.toBeDefined();
    expect(await readFile(mirrorPath, 'utf8')).toBe('# Global\nAlways verify.\n');
  });

  it('repairs a CLAUDE symlink that points away from canonical AGENTS.md', async () => {
    if (process.platform === 'win32') return;
    const wrongTarget = path.join(root, 'wrong-claude.md');
    const mirrorPath = path.join(root, '.happyherd', 'CLAUDE.md');
    await writeFile(wrongTarget, '# Wrong target\n');
    await symlink(wrongTarget, mirrorPath);

    await expect(prepareCommanderContext('athena')).resolves.toBeDefined();
    expect(await readFile(mirrorPath, 'utf8')).toBe('# Global\nAlways verify.\n');
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

});
