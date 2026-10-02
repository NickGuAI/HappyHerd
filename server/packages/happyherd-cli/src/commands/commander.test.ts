import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listCommanders } from '@/agentContext/commanderContext';
import { createCommanderFromManifest, handleCommanderCommand } from './commander';

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.HAPPYHERD_HOME_DIR;
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'athena-test',
    name: 'Athena Test',
    workspace: '/srv/workspace',
    role: 'Engineering commander',
    commanderMarkdown: `---\nidentity_and_scope:\n  name: Athena Test\n  commander_id: athena-test\n  workspace: /srv/workspace\n  role: Engineering commander\n---\n\n# Mission\nDeliver verified work.\n`,
    observationsJsonl: '{"observation":"seed"}\n',
    workingMemoryMarkdown: '# Working memory\n',
    longTermMemoryMarkdown: '# Long-term memory\n',
    learnings: [{ path: 'rules/learnings/WORKSPACE.md', content: '# Workspace rule\n' }],
    ...overrides,
  };
}

describe('commander creation scaffold', () => {
  it('publishes the exact agent-authored content in the canonical tree', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-'));
    cleanup.push(home);
    process.env.HAPPYHERD_HOME_DIR = home;

    const result = await createCommanderFromManifest(manifest());
    expect(result.path).toBe(path.join(home, 'commanders', 'athena-test'));
    expect(await readFile(path.join(result.path, 'COMMANDER.md'), 'utf8')).toContain('Deliver verified work.');
    expect(await readFile(path.join(result.path, 'agentcontext/memory/0-observations.jsonl'), 'utf8'))
      .toBe('{"observation":"seed"}\n');
    expect(await readFile(path.join(result.path, 'agentcontext/rules/learnings/WORKSPACE.md'), 'utf8'))
      .toBe('# Workspace rule\n');
    expect(await readdir(path.join(result.path, 'agentcontext/rules/learnings'))).toEqual(['WORKSPACE.md']);
  });

  it('rejects mismatched identity and leaves no commander behind', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-'));
    cleanup.push(home);
    process.env.HAPPYHERD_HOME_DIR = home;

    await expect(createCommanderFromManifest(manifest({ name: 'Different' })))
      .rejects.toThrow('COMMANDER.md name');
    await expect(readFile(path.join(home, 'commanders', 'athena-test', 'COMMANDER.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites an existing commander', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-'));
    cleanup.push(home);
    process.env.HAPPYHERD_HOME_DIR = home;
    await createCommanderFromManifest(manifest());
    await writeFile(path.join(home, 'commanders', 'athena-test', 'sentinel'), 'keep');

    await expect(createCommanderFromManifest(manifest())).rejects.toThrow('already exists');
    expect(await readFile(path.join(home, 'commanders', 'athena-test', 'sentinel'), 'utf8')).toBe('keep');
  });

  it('rejects learning paths outside commander AgentContext', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-'));
    cleanup.push(home);
    process.env.HAPPYHERD_HOME_DIR = home;
    await expect(createCommanderFromManifest(manifest({
      learnings: [{ path: '../escape.md', content: 'bad' }],
    }))).rejects.toThrow('escapes commander AgentContext');
  });

  it('isolates Commander creation to the configured machine home', async () => {
    const firstHome = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-machine-a-'));
    const secondHome = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-machine-b-'));
    cleanup.push(firstHome, secondHome);

    process.env.HAPPYHERD_HOME_DIR = firstHome;
    await createCommanderFromManifest(manifest());
    expect((await listCommanders()).commanders.map((entry) => entry.id)).toEqual(['athena-test']);

    process.env.HAPPYHERD_HOME_DIR = secondHome;
    expect((await listCommanders()).commanders).toEqual([]);
    await createCommanderFromManifest(manifest({
      commanderMarkdown: manifest().commanderMarkdown.replace(
        'Deliver verified work.',
        'Deliver work on the second machine.',
      ),
    }));

    expect(await readFile(
      path.join(firstHome, 'commanders', 'athena-test', 'COMMANDER.md'),
      'utf8',
    )).toContain('Deliver verified work.');
    expect(await readFile(
      path.join(secondHome, 'commanders', 'athena-test', 'COMMANDER.md'),
      'utf8',
    )).toContain('Deliver work on the second machine.');
  });
});


describe('shared guide correction command', () => {
  it('reports non-destructive creation and leaves help side-effect free', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-guide-command-'));
    cleanup.push(home);
    process.env.HAPPYHERD_HOME_DIR = home;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await handleCommanderCommand(['guide', '--help']);
      expect(await readdir(home)).toEqual([]);
      await expect(handleCommanderCommand(['guide', '--overwrite'])).rejects.toThrow('Usage:');
      expect(await readdir(home)).toEqual([]);
      await handleCommanderCommand(['guide', '--json']);
      const receipt = JSON.parse(log.mock.calls.at(-1)![0]);
      expect(receipt.files).toHaveLength(3);
      expect(receipt.files.every((file: { status: string }) => file.status === 'created')).toBe(true);
      await writeFile(path.join(home, 'AGENTS.md'), 'Owner guide');
      await handleCommanderCommand(['guide', '--json']);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).files.every((file: { status: string }) => file.status === 'preserved')).toBe(true);
      expect(await readFile(path.join(home, 'AGENTS.md'), 'utf8')).toBe('Owner guide');
    } finally {
      log.mockRestore();
    }
  });
});
