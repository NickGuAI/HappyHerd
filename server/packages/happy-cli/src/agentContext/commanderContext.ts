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
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { HappyHerdCommanderListResponse, HappyHerdCommanderSummary } from '@slopus/happy-wire';
import { configuration } from '@/configuration';

const BUNDLE_VERSION = 1;
const MANAGED_COPY_HEADER = '<!-- Managed by HappyHerd from AGENTS.md. Do not edit this copy. -->\n';

export interface CommanderContextBundle {
  commander: HappyHerdCommanderSummary | null;
  contextHash: string;
  bundlePath: string;
  globalAgentsPath: string | null;
  globalAgentContextPath: string;
}

export interface CommanderContextMetadata {
  commanderId?: string;
  commanderName?: string;
  commanderPath?: string;
  commanderWorkspace?: string;
  commanderAgentContextPath?: string;
  globalAgentsPath?: string;
  globalAgentContextPath?: string;
  contextHash?: string;
}

function homeDir(): string {
  return process.env.HAPPYHERD_HOME_DIR?.trim() || os.homedir();
}

export function agentContextRoot(): string {
  return path.resolve(process.env.HAPPYHERD_AGENTCONTEXT_ROOT?.trim() || path.join(homeDir(), '.herd'));
}

function commanderRoots(): string[] {
  const root = agentContextRoot();
  return [
    path.join(root, 'commanders'),
    path.join(root, 'commander'),
  ];
}

function canonicalAgentsPath(): string {
  return path.resolve(process.env.HAPPYHERD_AGENTS_FILE?.trim() || path.join(homeDir(), 'AGENTS.md'));
}

function claudeMirrorPath(): string {
  return path.resolve(process.env.HAPPYHERD_CLAUDE_FILE?.trim() || path.join(homeDir(), 'CLAUDE.md'));
}

function bundleRoot(): string {
  return path.join(
    path.resolve(process.env.HAPPY_HOME_DIR?.trim() || configuration.happyHomeDir),
    'agent-context',
    'bundles',
  );
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
  for (const root of commanderRoots()) {
    try {
      return await readCommander(root, commanderId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

export async function listCommanders(): Promise<HappyHerdCommanderListResponse> {
  const commanders: HappyHerdCommanderSummary[] = [];
  const seenDirectoryNames = new Set<string>();
  for (const root of commanderRoots()) {
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
      if (seenDirectoryNames.has(entry)) continue;
      seenDirectoryNames.add(entry);
      try {
        const commander = await readCommander(root, entry);
        if (commander) commanders.push(commander);
      } catch {
        // A malformed Commander is isolated from the rest of the picker. The
        // selected-id path still returns the actionable validation error.
      }
    }
  }
  commanders.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const agentsPath = canonicalAgentsPath();
  return {
    commanders,
    globalAgentsPath: await isReadable(agentsPath) ? agentsPath : null,
  };
}

async function ensureClaudeMirror(agentsPath: string, content: string): Promise<void> {
  const mirrorPath = claudeMirrorPath();
  if (mirrorPath === agentsPath) return;

  try {
    const stats = await lstat(mirrorPath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(mirrorPath);
      const resolvedTarget = path.resolve(path.dirname(mirrorPath), target);
      if (resolvedTarget === agentsPath) return;
      throw new Error(`CLAUDE.md points to ${resolvedTarget}, not canonical ${agentsPath}`);
    }
    const existing = await readFile(mirrorPath, 'utf8');
    if (existing === content) return;
    if (existing.startsWith(MANAGED_COPY_HEADER)) {
      await writeFile(mirrorPath, MANAGED_COPY_HEADER + content, { mode: 0o600 });
      return;
    }
    throw new Error(`CLAUDE.md diverges from canonical AGENTS.md at ${agentsPath}; reconcile it before starting a Commander session`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(path.dirname(mirrorPath), { recursive: true });
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
}): string {
  const lines = [
    '# HappyHerd session context',
    '',
    `Bundle version: ${BUNDLE_VERSION}`,
    `Global AGENTS.md: ${options.globalAgentsPath ?? '(not present)'}`,
    `Global AgentContext: ${options.globalAgentContextPath}`,
    `Commander: ${options.commander ? `${options.commander.name} (${options.commander.id})` : '(none)'}`,
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
  return lines.join('\n');
}

export async function prepareCommanderContext(commanderId?: string | null): Promise<CommanderContextBundle> {
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

  const globalAgentContextPath = path.join(agentContextRoot(), 'agentcontext');
  const bundleText = buildBundleText({
    globalContent,
    globalAgentsPath: hasAgents ? agentsPath : null,
    globalAgentContextPath,
    commander,
    commanderContent,
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
  };
}

export function contextEnvironment(bundle: CommanderContextBundle): Record<string, string> {
  return {
    HAPPYHERD_CONTEXT_BUNDLE_PATH: bundle.bundlePath,
    HAPPYHERD_CONTEXT_HASH: bundle.contextHash,
    HAPPYHERD_GLOBAL_AGENTCONTEXT_PATH: bundle.globalAgentContextPath,
    ...(bundle.globalAgentsPath ? { HAPPYHERD_GLOBAL_AGENTS_PATH: bundle.globalAgentsPath } : {}),
    ...(bundle.commander ? {
      HAPPYHERD_COMMANDER_ID: bundle.commander.id,
      HAPPYHERD_COMMANDER_NAME: bundle.commander.name,
      HAPPYHERD_COMMANDER_PATH: bundle.commander.commanderPath,
      HAPPYHERD_COMMANDER_WORKSPACE: bundle.commander.workspace,
      HAPPYHERD_COMMANDER_AGENTCONTEXT_PATH: bundle.commander.agentContextPath,
    } : {}),
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
    ...(process.env.HAPPYHERD_CONTEXT_HASH ? { contextHash: process.env.HAPPYHERD_CONTEXT_HASH } : {}),
  };
}

export function mergeContextPrompt(base: string | undefined, override: string | null | undefined): string | undefined {
  const extra = override?.trim();
  if (base && extra) return `${base}\n\n## Per-message appended instructions\n\n${extra}`;
  return base || extra || undefined;
}
