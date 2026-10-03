import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSharedKnowledge } from './sharedKnowledge';
import { contextEnvironment, instructionReceiptMetadata, prepareCommanderContext, readContextPromptFromEnvironment } from './commanderContext';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-shared-guide-'));
  vi.stubEnv('HAPPYHERD_HOME_DIR', root);
  vi.stubEnv('TMPDIR', root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('shared knowledge seed', () => {
  it('creates portable linked guides in a blank configured home and preserves them on reinstall', async () => {
    const first = await ensureSharedKnowledge(root);
    expect(first.files.map(file => file.status)).toEqual(['created', 'created', 'created']);
    const contents = await Promise.all(first.files.map(file => readFile(file.path, 'utf8')));
    for (const content of contents) {
      expect(content).not.toContain('/Users/');
      // Historical-path regression fixture. <!-- rename:preserve -->
      expect(content).not.toContain('happy-cli/bin/happy.mjs');
      // <!-- /rename:preserve -->
      expect(content.length).toBeGreaterThan(100);
    }
    expect(contents[2]).toContain('agentcontext/README.md');
    expect(contents[0]).toContain('happyherd-cli.md');
    expect((await ensureSharedKnowledge(root)).files.map(file => file.status)).toEqual(['preserved', 'preserved', 'preserved']);
    expect(await Promise.all(first.files.map(file => readFile(file.path, 'utf8')))).toEqual(contents);
  });

  it('preserves customized, empty and linked guides and private Commander state', async () => {
    const privateDir = path.join(root, 'commanders', 'custom', 'agentcontext', 'memory');
    await mkdir(privateDir, { recursive: true });
    const privatePath = path.join(privateDir, '1-working-memory.md');
    await writeFile(privatePath, 'private memory');
    await mkdir(path.join(root, 'agentcontext'));
    await writeFile(path.join(root, 'AGENTS.md'), 'owner instructions');
    await writeFile(path.join(root, 'agentcontext', 'README.md'), '');
    const target = path.join(root, 'owner-guide.md');
    await writeFile(target, 'owner operations');
    await symlink(target, path.join(root, 'agentcontext', 'happyherd-cli.md'));
    expect((await ensureSharedKnowledge(root)).files.every(file => file.status === 'preserved')).toBe(true);
    expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe('owner instructions');
    expect(await readFile(path.join(root, 'agentcontext', 'README.md'), 'utf8')).toBe('');
    expect(await readFile(target, 'utf8')).toBe('owner operations');
    expect(await readFile(privatePath, 'utf8')).toBe('private memory');
  });

  it('delivers explicit on-demand directions in startup and regenerated resume receipts', async () => {
    for (const phase of ['startup', 'resume']) {
      const bundle = await prepareCommanderContext(null, root);
      for (const [key, value] of Object.entries(contextEnvironment(bundle))) vi.stubEnv(key, value);
      const prompt = await readContextPromptFromEnvironment();
      expect(prompt, phase).toContain('At every session startup and resume, read');
      for (const name of ['README.md', 'happyherd-cli.md']) {
        const target = path.join(root, 'agentcontext', name);
        expect(prompt).toContain(target);
        expect((await readFile(target, 'utf8')).length).toBeGreaterThan(100);
      }
      expect(prompt).toContain('their contents have not been loaded into this bundle');
      expect(instructionReceiptMetadata({ provider: 'codex', layer: 'developer', deliveredInstruction: prompt! })).toMatchObject({
        instructionProvider: 'codex', instructionLayer: 'developer', instructionHash: expect.any(String),
      });
    }
  });
});
