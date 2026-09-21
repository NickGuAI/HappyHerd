import { open, lstat, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { agentContextRoot, listCommanders, parseCommanderIdentity } from '@/agentContext/commanderContext';

const LearningSchema = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(1024 * 1024),
}).strict();

export const CommanderCreationManifestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  name: z.string().trim().min(1).max(160),
  workspace: z.string().trim().min(1),
  role: z.string().trim().min(1).max(500),
  commanderMarkdown: z.string().min(1).max(2 * 1024 * 1024),
  observationsJsonl: z.string().max(2 * 1024 * 1024).default(''),
  workingMemoryMarkdown: z.string().max(2 * 1024 * 1024).default(''),
  longTermMemoryMarkdown: z.string().max(2 * 1024 * 1024).default(''),
  learnings: z.array(LearningSchema).max(100).default([]),
}).strict();

export type CommanderCreationManifest = z.infer<typeof CommanderCreationManifestSchema>;

function safeLearningPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`Learning path must be relative: ${relativePath}`);
  const normalized = path.normalize(relativePath);
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Learning path escapes commander AgentContext: ${relativePath}`);
  }
  return normalized;
}

function validateManifestIdentity(manifest: CommanderCreationManifest): void {
  if (!path.isAbsolute(manifest.workspace)) {
    throw new Error('Commander workspace must be an absolute path');
  }
  const identity = parseCommanderIdentity(manifest.commanderMarkdown);
  if (identity.commanderId !== manifest.id) {
    throw new Error(`COMMANDER.md commander_id must equal manifest id "${manifest.id}"`);
  }
  if (identity.name !== manifest.name) {
    throw new Error(`COMMANDER.md name must equal manifest name "${manifest.name}"`);
  }
  if (identity.workspace !== manifest.workspace) {
    throw new Error(`COMMANDER.md workspace must equal manifest workspace "${manifest.workspace}"`);
  }
  if (identity.role !== manifest.role) {
    throw new Error('COMMANDER.md role must equal manifest role');
  }
  manifest.learnings.forEach((learning) => safeLearningPath(learning.path));
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Materialize agent-authored Commander content into the canonical HappyHerd
 * tree. The command owns validation and atomic publication only; it never
 * invents identity, memory, or learning content on the agent's behalf.
 */
export async function createCommanderFromManifest(
  rawManifest: unknown,
): Promise<{ id: string; path: string }> {
  const manifest = CommanderCreationManifestSchema.parse(rawManifest);
  validateManifestIdentity(manifest);

  const root = path.join(agentContextRoot(), 'commanders');
  const destination = path.join(root, manifest.id);
  const lockPath = path.join(root, `.${manifest.id}.create.lock`);
  await mkdir(root, { recursive: true, mode: 0o700 });

  let lock: Awaited<ReturnType<typeof open>> | null = null;
  let staging: string | null = null;
  try {
    lock = await open(lockPath, 'wx', 0o600);
    if (await pathExists(destination)) {
      throw new Error(`Commander "${manifest.id}" already exists`);
    }

    staging = await mkdtemp(path.join(root, '.commander-create-'));
    const agentContext = path.join(staging, 'agentcontext');
    const memory = path.join(agentContext, 'memory');
    const rules = path.join(agentContext, 'rules');
    await mkdir(memory, { recursive: true, mode: 0o700 });
    await mkdir(path.join(rules, 'learnings'), { recursive: true, mode: 0o700 });

    await Promise.all([
      writeFile(path.join(staging, 'COMMANDER.md'), manifest.commanderMarkdown, { mode: 0o600 }),
      writeFile(path.join(memory, '0-observations.jsonl'), manifest.observationsJsonl, { mode: 0o600 }),
      writeFile(path.join(memory, '1-working-memory.md'), manifest.workingMemoryMarkdown, { mode: 0o600 }),
      writeFile(path.join(memory, '2-long-term-memory.md'), manifest.longTermMemoryMarkdown, { mode: 0o600 }),
    ]);

    for (const learning of manifest.learnings) {
      const target = path.join(agentContext, safeLearningPath(learning.path));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, learning.content, { mode: 0o600 });
    }

    await rename(staging, destination);
    staging = null;
    return { id: manifest.id, path: destination };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && !lock) {
      throw new Error(`Commander "${manifest.id}" is already being created`);
    }
    throw error;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (lock) await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

function optionValue(args: string[], option: string): string | null {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] ?? null : null;
}

export async function handleCommanderCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (action === 'list') {
    console.log(JSON.stringify(await listCommanders(), null, 2));
    return;
  }
  if (action === 'create') {
    const manifestPath = optionValue(args.slice(1), '--manifest');
    if (!manifestPath) throw new Error('Usage: happyherd commander create --manifest <file>');
    const raw = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8')) as unknown;
    console.log(JSON.stringify(await createCommanderFromManifest(raw), null, 2));
    return;
  }
  console.log(`happyherd commander

Usage:
  happyherd commander list
  happyherd commander create --manifest <file>
`);
}
