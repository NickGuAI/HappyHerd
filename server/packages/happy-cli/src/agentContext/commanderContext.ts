import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { HappyHerdCommanderListResponse, HappyHerdCommanderSummary } from '@slopus/happy-wire';
import { configuration } from '@/configuration';

const BUNDLE_VERSION = 2;
const INSTRUCTION_RECEIPT_VERSION = 1;
const MANAGED_COPY_HEADER = '<!-- Managed by HappyHerd from AGENTS.md. Do not edit this copy. -->\n';

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

function bundleRoot(): string {
  return path.join(agentContextRoot(), 'agent-context', 'bundles');
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
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
    '',
    'The global AGENTS.md and selected COMMANDER.md below are authoritative instructions.',
    'Use the referenced AgentContext directories for file routing and load additional context on demand.',
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
  if (commanderId) {
    commander = await readCommanderById(commanderId);
    if (!commander) throw new Error(`Commander "${commanderId}" was not found`);
    commanderContent = await readFile(commander.commanderPath, 'utf8');
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
    projectGuidancePath: projectGuidance?.filePath ?? null,
    projectGuidanceContent: projectGuidance?.content ?? '',
  });
  const contextHash = createHash('sha256').update(bundleText).digest('hex');
  const root = bundleRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const bundlePath = path.join(root, `${contextHash}.md`);
  if (!(await isReadable(bundlePath))) {
    const temporaryPath = `${bundlePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, bundleText, { mode: 0o600 });
    await rename(temporaryPath, bundlePath);
  }
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
  const content = await readFile(bundlePath, 'utf8');
  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error('HappyHerd Commander context bundle failed integrity validation');
  }
  return content;
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
