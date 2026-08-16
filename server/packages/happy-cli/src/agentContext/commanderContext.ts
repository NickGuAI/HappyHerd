import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { HappyHerdCommanderListResponse, HappyHerdCommanderSummary } from '@slopus/happy-wire';
import { configuration } from '@/configuration';

const BUNDLE_VERSION = 3;
const INSTRUCTION_RECEIPT_VERSION = 1;
const COMMANDER_MEMORY_MAX_BYTES = 64 * 1024;
const MANAGED_COPY_HEADER = '<!-- Managed by HappyHerd from AGENTS.md. Do not edit this copy. -->\n';

type CommanderMemorySnapshot = {
  tier: 'L2' | 'L3';
  label: 'working memory' | 'long-term memory';
  filePath: string;
  content: string;
  includedBytes: number;
  sourceBytes: number;
  truncated: boolean;
};

export interface CommanderContextBundle {
  commander: HappyHerdCommanderSummary | null;
  contextHash: string;
  bundlePath: string;
  globalAgentsPath: string | null;
  globalAgentContextPath: string;
  projectGuidancePath: string | null;
}

export interface CommanderContextMetadata {
  commanderId?: string;
  commanderName?: string;
  commanderPath?: string;
  commanderWorkspace?: string;
  commanderAgentContextPath?: string;
  globalAgentsPath?: string;
  globalAgentContextPath?: string;
  projectGuidancePath?: string;
  contextHash?: string;
  instructionReceiptVersion?: number;
  instructionProvider?: 'codex' | 'claude';
  instructionLayer?: 'developer' | 'system-append';
  instructionHash?: string;
}

export function agentContextRoot(): string {
  return path.resolve(process.env.HAPPY_HOME_DIR?.trim() || configuration.happyHomeDir);
}

function commanderRoot(): string {
  return path.join(agentContextRoot(), 'commanders');
}

function canonicalAgentsPath(): string {
  return path.join(agentContextRoot(), 'AGENTS.md');
}

function claudeMirrorPath(): string {
  return path.join(agentContextRoot(), 'CLAUDE.md');
}

async function writeTransientBundle(content: string, contextHash: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'happyherd-context-'));
  const bundlePath = path.join(root, `${contextHash}.md`);
  await writeFile(bundlePath, content, { mode: 0o600 });
  return bundlePath;
}

function isHappyHerdTransientBundle(bundlePath: string): boolean {
  const bundleRoot = path.dirname(path.resolve(bundlePath));
  return path.dirname(bundleRoot) === path.resolve(tmpdir())
    && path.basename(bundleRoot).startsWith('happyherd-context-');
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readCommanderMemory(
  commander: HappyHerdCommanderSummary,
  tier: CommanderMemorySnapshot['tier'],
  label: CommanderMemorySnapshot['label'],
  fileName: string,
): Promise<CommanderMemorySnapshot | null> {
  const candidate = path.join(commander.agentContextPath, 'memory', fileName);
  if (!(await isReadable(candidate))) return null;

  const filePath = await resolveInside(commander.agentContextPath, candidate);
  const file = await open(filePath, 'r');
  try {
    const stats = await file.stat();
    const bytesToRead = Math.min(stats.size, COMMANDER_MEMORY_MAX_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0);
    // StringDecoder withholds an incomplete trailing UTF-8 sequence, so the
    // byte cap cannot introduce a replacement character into the prompt.
    const content = new StringDecoder('utf8').write(buffer.subarray(0, bytesRead));
    const includedBytes = Buffer.byteLength(content, 'utf8');
    return {
      tier,
      label,
      filePath,
      content,
      includedBytes,
      sourceBytes: stats.size,
      truncated: stats.size > includedBytes,
    };
  } finally {
    await file.close();
  }
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Extract only the small identity_and_scope surface used by the picker.
 * COMMANDER.md remains the source of truth and is passed through unchanged;
 * this is deliberately not a general YAML parser.
 */
export function parseCommanderIdentity(markdown: string): {
  name?: string;
  commanderId?: string;
  workspace?: string;
  role?: string;
} {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  const result: { name?: string; commanderId?: string; workspace?: string; role?: string } = {};
  if (match) {
    let inIdentityScope = false;
    for (const line of match[1].split(/\r?\n/)) {
      if (/^identity_and_scope:\s*$/.test(line)) {
        inIdentityScope = true;
        continue;
      }
      if (inIdentityScope && /^\S/.test(line) && !line.startsWith('#')) {
        break;
      }
      if (!inIdentityScope) continue;
      const field = line.match(/^\s{2,}(name|commander_id|workspace|role):\s*(.*?)\s*$/);
      if (!field) continue;
      const value = parseScalar(field[2]);
      if (!value) continue;
      if (field[1] === 'name') result.name = value;
      if (field[1] === 'commander_id') result.commanderId = value;
      if (field[1] === 'workspace') result.workspace = value;
      if (field[1] === 'role') result.role = value;
    }
  }

  // Established Herd Commander files predate the frontmatter contract. Only
  // inspect their bounded header so prose later in the file cannot silently
  // redefine identity or workspace routing.
  const legacyHeader = markdown.split(/\r?\n/).slice(0, 40).join('\n');
  const legacyIdentity = legacyHeader.match(/^You are\s+([^,\n.]+?)(?:,\s*(.+?))?\.\s*$/m);
  const legacyWorkspace = legacyHeader.match(/^Workspace:\s*`([^`\n]+)`\s*$/m)
    ?? legacyHeader.match(/^Workspace:\s*(\/\S+)\s*$/m);
  if (!result.name && legacyIdentity?.[1]?.trim()) result.name = legacyIdentity[1].trim();
  if (!result.role && legacyIdentity?.[2]?.trim()) result.role = legacyIdentity[2].trim();
  if (!result.workspace && legacyWorkspace?.[1]?.trim()) result.workspace = legacyWorkspace[1].trim();
  return result;
}

async function resolveInside(root: string, candidate: string): Promise<string> {
  const realRoot = await realpath(root);
  const realCandidate = await realpath(candidate);
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Commander path escapes the configured AgentContext root');
  }
  return realCandidate;
}

async function readCommander(root: string, directoryName: string): Promise<HappyHerdCommanderSummary | null> {
  if (!directoryName || directoryName === '.' || directoryName === '..' || directoryName.includes(path.sep)) {
    return null;
  }
  const commanderDir = await resolveInside(root, path.join(root, directoryName));
  const commanderPath = await resolveInside(root, path.join(commanderDir, 'COMMANDER.md'));
  const markdown = await readFile(commanderPath, 'utf8');
  const identity = parseCommanderIdentity(markdown);
  const id = identity.commanderId || directoryName;
  if (id !== directoryName) {
    throw new Error(`Commander directory "${directoryName}" does not match commander_id "${id}"`);
  }
  const workspace = identity.workspace?.trim();
  if (!workspace || !path.isAbsolute(workspace)) {
    throw new Error(`Commander "${id}" must declare an absolute workspace path`);
  }
  let agentContextPath = commanderDir;
  const nestedAgentContext = path.join(commanderDir, 'agentcontext');
  try {
    const resolved = await resolveInside(root, nestedAgentContext);
    if ((await lstat(resolved)).isDirectory()) agentContextPath = resolved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    id,
    name: identity.name || id,
    ...(identity.role ? { role: identity.role } : {}),
    workspace,
    commanderPath,
    agentContextPath,
  };
}

async function readCommanderById(commanderId: string): Promise<HappyHerdCommanderSummary | null> {
  try {
    return await readCommander(commanderRoot(), commanderId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return null;
}

export async function listCommanders(): Promise<HappyHerdCommanderListResponse> {
  const commanders: HappyHerdCommanderSummary[] = [];
  const root = commanderRoot();
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const entry of entries) {
    try {
      const commander = await readCommander(root, entry);
      if (commander) commanders.push(commander);
    } catch {
      // A malformed Commander is isolated from the rest of the picker. The
      // selected-id path still returns the actionable validation error.
    }
  }
  commanders.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const agentsPath = canonicalAgentsPath();
  return {
    commanders,
    globalAgentsPath: await isReadable(agentsPath) ? agentsPath : null,
  };
}

async function findClosestProjectGuidance(
  startPath: string | undefined,
  excludedPaths: ReadonlySet<string>,
): Promise<{ filePath: string; content: string } | null> {
  if (!startPath) return null;
  let current = path.resolve(startPath);
  try {
    if (!(await lstat(current)).isDirectory()) current = path.dirname(current);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  while (true) {
    for (const fileName of ['AGENTS.md', 'CLAUDE.md']) {
      const candidate = path.join(current, fileName);
      if (excludedPaths.has(candidate) || !(await isReadable(candidate))) continue;
      return { filePath: candidate, content: await readFile(candidate, 'utf8') };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function ensureClaudeMirror(agentsPath: string, content: string): Promise<void> {
  const mirrorPath = claudeMirrorPath();
  if (mirrorPath === agentsPath) return;

  let replaceMirror = false;

  try {
    const stats = await lstat(mirrorPath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(mirrorPath);
      const resolvedTarget = path.resolve(path.dirname(mirrorPath), target);
      if (resolvedTarget === agentsPath) return;
      replaceMirror = true;
    } else if (stats.isFile()) {
      const existing = await readFile(mirrorPath, 'utf8');
      if (existing === content) return;
      if (existing.startsWith(MANAGED_COPY_HEADER)) {
        await writeFile(mirrorPath, MANAGED_COPY_HEADER + content, { mode: 0o600 });
        return;
      }
      replaceMirror = true;
    } else {
      throw new Error(`CLAUDE.md mirror path is not a file or symbolic link: ${mirrorPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(path.dirname(mirrorPath), { recursive: true });
  if (replaceMirror) await unlink(mirrorPath);
  if (process.platform !== 'win32') {
    await symlink(path.relative(path.dirname(mirrorPath), agentsPath), mirrorPath);
    return;
  }
  await writeFile(mirrorPath, MANAGED_COPY_HEADER + content, { mode: 0o600 });
}

function buildBundleText(options: {
  globalContent: string;
  globalAgentsPath: string | null;
  globalAgentContextPath: string;
  commander: HappyHerdCommanderSummary | null;
  commanderContent: string;
  commanderMemories: CommanderMemorySnapshot[];
  projectGuidancePath: string | null;
  projectGuidanceContent: string;
}): string {
  const lines = [
    '# HappyHerd session context',
    '',
    `Bundle version: ${BUNDLE_VERSION}`,
    `Global AGENTS.md: ${options.globalAgentsPath ?? '(not present)'}`,
    `Global AgentContext: ${options.globalAgentContextPath}`,
    `Commander: ${options.commander ? `${options.commander.name} (${options.commander.id})` : '(none)'}`,
    `Closest project guidance: ${options.projectGuidancePath ?? '(not present)'}`,
    ...(options.commander ? [
      `Commander memory auto-load limit: ${COMMANDER_MEMORY_MAX_BYTES} bytes per file`,
      'Commander L1 observations: on demand (not included)',
      ...options.commanderMemories.map((memory) => (
        `Commander ${memory.tier} ${memory.label}: ${memory.filePath} (${memory.includedBytes}/${memory.sourceBytes} bytes${memory.truncated ? '; truncated' : ''})`
      )),
    ] : []),
    '',
    'The global AGENTS.md and selected COMMANDER.md below are authoritative instructions.',
    'Selected Commander L2 and L3 memory are loaded below with bounded provenance; L1 evidence and other context stay on demand.',
    'Do not invent a second memory or task model. Preserve the existing AgentContext tree unchanged.',
    '',
    '## Global AGENTS.md',
    '',
    options.globalContent || '(No global AGENTS.md was present.)',
  ];
  if (options.commander) {
    lines.push(
      '',
      '## Selected COMMANDER.md',
      '',
      options.commanderContent,
      '',
      `Commander AgentContext directory: ${options.commander.agentContextPath}`,
    );
  }
  for (const memory of options.commanderMemories) {
    lines.push(
      '',
      `## Selected Commander ${memory.tier} ${memory.label}`,
      '',
      `Source: ${memory.filePath}`,
      `Included bytes: ${memory.includedBytes}/${memory.sourceBytes}`,
      `Truncated: ${memory.truncated ? 'yes' : 'no'}`,
      '',
      memory.content || '(The memory file was empty.)',
    );
  }
  if (options.projectGuidancePath) {
    lines.push(
      '',
      '## Closest project guidance',
      '',
      options.projectGuidanceContent,
    );
  }
  return lines.join('\n');
}

export async function prepareCommanderContext(
  commanderId?: string | null,
  workingDirectory?: string,
): Promise<CommanderContextBundle> {
  const agentsPath = canonicalAgentsPath();
  const hasAgents = await isReadable(agentsPath);
  const globalContent = hasAgents ? await readFile(agentsPath, 'utf8') : '';
  if (hasAgents) await ensureClaudeMirror(agentsPath, globalContent);

  let commander: HappyHerdCommanderSummary | null = null;
  let commanderContent = '';
  let commanderMemories: CommanderMemorySnapshot[] = [];
  if (commanderId) {
    commander = await readCommanderById(commanderId);
    if (!commander) throw new Error(`Commander "${commanderId}" was not found`);
    commanderContent = await readFile(commander.commanderPath, 'utf8');
    commanderMemories = (await Promise.all([
      readCommanderMemory(commander, 'L2', 'working memory', '1-working-memory.md'),
      readCommanderMemory(commander, 'L3', 'long-term memory', '2-long-term-memory.md'),
    ])).filter((memory): memory is CommanderMemorySnapshot => memory !== null);
  }

  const projectGuidance = await findClosestProjectGuidance(
    workingDirectory ?? commander?.workspace,
    new Set([
      agentsPath,
      path.join(homedir(), 'AGENTS.md'),
      path.join(homedir(), 'CLAUDE.md'),
    ]),
  );

  const globalAgentContextPath = path.join(agentContextRoot(), 'agentcontext');
  const bundleText = buildBundleText({
    globalContent,
    globalAgentsPath: hasAgents ? agentsPath : null,
    globalAgentContextPath,
    commander,
    commanderContent,
    commanderMemories,
    projectGuidancePath: projectGuidance?.filePath ?? null,
    projectGuidanceContent: projectGuidance?.content ?? '',
  });
  const contextHash = createHash('sha256').update(bundleText).digest('hex');
  const bundlePath = await writeTransientBundle(bundleText, contextHash);
  return {
    commander,
    contextHash,
    bundlePath,
    globalAgentsPath: hasAgents ? agentsPath : null,
    globalAgentContextPath,
    projectGuidancePath: projectGuidance?.filePath ?? null,
  };
}

export function contextEnvironment(bundle: CommanderContextBundle): Record<string, string> {
  return {
    HAPPYHERD_CONTEXT_BUNDLE_PATH: bundle.bundlePath,
    HAPPYHERD_CONTEXT_HASH: bundle.contextHash,
    HAPPYHERD_GLOBAL_AGENTCONTEXT_PATH: bundle.globalAgentContextPath,
    ...(bundle.globalAgentsPath ? { HAPPYHERD_GLOBAL_AGENTS_PATH: bundle.globalAgentsPath } : {}),
    ...(bundle.projectGuidancePath ? { HAPPYHERD_PROJECT_GUIDANCE_PATH: bundle.projectGuidancePath } : {}),
    ...(bundle.commander ? {
      HAPPYHERD_COMMANDER_ID: bundle.commander.id,
      HAPPYHERD_COMMANDER_NAME: bundle.commander.name,
      HAPPYHERD_COMMANDER_PATH: bundle.commander.commanderPath,
      HAPPYHERD_COMMANDER_WORKSPACE: bundle.commander.workspace,
      HAPPYHERD_COMMANDER_AGENTCONTEXT_PATH: bundle.commander.agentContextPath,
    } : {}),
  };
}

export function instructionReceiptMetadata(options: {
  provider: 'codex' | 'claude';
  layer: 'developer' | 'system-append';
  deliveredInstruction: string;
}): Required<Pick<CommanderContextMetadata,
  'instructionReceiptVersion' | 'instructionProvider' | 'instructionLayer' | 'instructionHash'
>> {
  return {
    instructionReceiptVersion: INSTRUCTION_RECEIPT_VERSION,
    instructionProvider: options.provider,
    instructionLayer: options.layer,
    instructionHash: createHash('sha256').update(options.deliveredInstruction).digest('hex'),
  };
}

export async function readContextPromptFromEnvironment(): Promise<string | undefined> {
  const bundlePath = process.env.HAPPYHERD_CONTEXT_BUNDLE_PATH;
  const expectedHash = process.env.HAPPYHERD_CONTEXT_HASH;
  if (!bundlePath || !expectedHash) return undefined;
  try {
    const content = await readFile(bundlePath, 'utf8');
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error('HappyHerd Commander context bundle failed integrity validation');
    }
    return content;
  } finally {
    if (isHappyHerdTransientBundle(bundlePath)) {
      await unlink(bundlePath).catch(() => undefined);
      await rmdir(path.dirname(bundlePath)).catch(() => undefined);
    }
  }
}

export function contextMetadataFromEnvironment(): CommanderContextMetadata {
  return {
    ...(process.env.HAPPYHERD_COMMANDER_ID ? { commanderId: process.env.HAPPYHERD_COMMANDER_ID } : {}),
    ...(process.env.HAPPYHERD_COMMANDER_NAME ? { commanderName: process.env.HAPPYHERD_COMMANDER_NAME } : {}),
    ...(process.env.HAPPYHERD_COMMANDER_PATH ? { commanderPath: process.env.HAPPYHERD_COMMANDER_PATH } : {}),
    ...(process.env.HAPPYHERD_COMMANDER_WORKSPACE ? { commanderWorkspace: process.env.HAPPYHERD_COMMANDER_WORKSPACE } : {}),
    ...(process.env.HAPPYHERD_COMMANDER_AGENTCONTEXT_PATH ? { commanderAgentContextPath: process.env.HAPPYHERD_COMMANDER_AGENTCONTEXT_PATH } : {}),
    ...(process.env.HAPPYHERD_GLOBAL_AGENTS_PATH ? { globalAgentsPath: process.env.HAPPYHERD_GLOBAL_AGENTS_PATH } : {}),
    ...(process.env.HAPPYHERD_GLOBAL_AGENTCONTEXT_PATH ? { globalAgentContextPath: process.env.HAPPYHERD_GLOBAL_AGENTCONTEXT_PATH } : {}),
    ...(process.env.HAPPYHERD_PROJECT_GUIDANCE_PATH ? { projectGuidancePath: process.env.HAPPYHERD_PROJECT_GUIDANCE_PATH } : {}),
    ...(process.env.HAPPYHERD_CONTEXT_HASH ? { contextHash: process.env.HAPPYHERD_CONTEXT_HASH } : {}),
  };
}

export function mergeContextPrompt(base: string | undefined, override: string | null | undefined): string | undefined {
  const extra = override?.trim();
  if (base && extra) return `${base}\n\n## Per-message appended instructions\n\n${extra}`;
  return base || extra || undefined;
}
