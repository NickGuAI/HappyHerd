import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { listCommanders } from '@/agentContext/commanderContext';
import { createCommanderFromManifest } from './commander';

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.HAPPY_HOME_DIR;
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
    process.env.HAPPY_HOME_DIR = home;

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
    process.env.HAPPY_HOME_DIR = home;

    await expect(createCommanderFromManifest(manifest({ name: 'Different' })))
      .rejects.toThrow('COMMANDER.md name');
    await expect(readFile(path.join(home, 'commanders', 'athena-test', 'COMMANDER.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites an existing commander', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-'));
    cleanup.push(home);
    process.env.HAPPY_HOME_DIR = home;
    await createCommanderFromManifest(manifest());
    await writeFile(path.join(home, 'commanders', 'athena-test', 'sentinel'), 'keep');

    await expect(createCommanderFromManifest(manifest())).rejects.toThrow('already exists');
    expect(await readFile(path.join(home, 'commanders', 'athena-test', 'sentinel'), 'utf8')).toBe('keep');
  });

  it('rejects learning paths outside commander AgentContext', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-'));
    cleanup.push(home);
    process.env.HAPPY_HOME_DIR = home;
    await expect(createCommanderFromManifest(manifest({
      learnings: [{ path: '../escape.md', content: 'bad' }],
    }))).rejects.toThrow('escapes commander AgentContext');
  });

  it('isolates Commander creation to the configured machine home', async () => {
    const firstHome = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-machine-a-'));
    const secondHome = await mkdtemp(path.join(tmpdir(), 'happyherd-commander-machine-b-'));
    cleanup.push(firstHome, secondHome);

    process.env.HAPPY_HOME_DIR = firstHome;
    await createCommanderFromManifest(manifest());
    expect((await listCommanders()).commanders.map((entry) => entry.id)).toEqual(['athena-test']);

    process.env.HAPPY_HOME_DIR = secondHome;
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
