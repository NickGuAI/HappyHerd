type ParentSession = {
  id: string;
  metadata: unknown;
};

export type ResolvedSideChatMachine = {
  id: string;
  active: boolean;
};

type SpawnSideChatInput = {
  machine: ResolvedSideChatMachine;
  directory: string;
  approvedNewDirectoryCreation: false;
  agent: 'claude' | 'codex';
  resumeClaudeSessionId?: string;
  resumeCodexThreadId?: string;
  parentSessionId: string;
  isSideChat: true;
};

type SpawnSideChatResult =
  | { type: 'success'; sessionId: string }
  | { type: 'requestToApproveDirectoryCreation'; directory: string }
  | { type: 'error'; errorMessage: string };

export type SideChatCommandDependencies = {
  resolveSession: (sessionId: string) => Promise<ParentSession>;
  resolveMachine: (machineId: string) => Promise<ResolvedSideChatMachine>;
  machineRpc: (
    machine: ResolvedSideChatMachine,
    method: string,
    params: Record<string, string>,
  ) => Promise<unknown>;
  createMachineSession: (input: SpawnSideChatInput) => Promise<SpawnSideChatResult>;
};

export type SideChatHandlerDependencies = {
  execute: (request: SideChatLifecycleRequest) => Promise<SideChatLifecycleReceipt>;
  output?: (value: string) => void;
  setExitCode?: (code: number) => void;
};

export type CreateChildSideChatResult = {
  sessionId: string;
};

export type SideChatLifecycleStatus = 'running' | 'stopped' | 'archived';

export type SideChatStatusReceipt = {
  sessionId: string;
  parentSessionId: string;
  status: SideChatLifecycleStatus;
  providerRunning: boolean;
  active: boolean;
  resumable: boolean;
};

export type SideChatPhaseReceipt = {
  phase: 'resolve' | 'stop' | 'archive-metadata' | 'deactivate' | 'resume' | 'readback';
  status: 'succeeded' | 'skipped' | 'failed';
  message?: string;
};

export type SideChatLifecycleRequest =
  | { action: 'create'; parentSessionId: string }
  | { action: 'list'; parentSessionId: string }
  | { action: 'status' | 'stop' | 'close' | 'reopen'; sessionId: string }
  | { action: 'close-all'; parentSessionId: string };

type SideChatSingleAction = 'create' | 'status' | 'stop' | 'close' | 'reopen';

export type SideChatSingleReceipt = {
  schemaVersion: 1;
  type: 'side-chat';
  action: SideChatSingleAction;
  success: boolean;
  parentSessionId: string | null;
  sessionId: string | null;
  child: SideChatStatusReceipt | null;
  phases: SideChatPhaseReceipt[];
};

export type SideChatListReceipt = {
  schemaVersion: 1;
  type: 'side-chat-list';
  action: 'list';
  success: boolean;
  parentSessionId: string;
  count: number;
  openCount: number;
  archivedCount: number;
  children: SideChatStatusReceipt[];
  failures: Array<{ sessionId: string; phase: 'readback'; message: string }>;
};

export type SideChatCloseAllReceipt = {
  schemaVersion: 1;
  type: 'side-chat-close-all';
  action: 'close-all';
  success: boolean;
  parentSessionId: string;
  total: number;
  closed: number;
  failed: number;
  children: SideChatSingleReceipt[];
};

export type SideChatLifecycleReceipt =
  | SideChatSingleReceipt
  | SideChatListReceipt
  | SideChatCloseAllReceipt;

type SideChatSource = Readonly<{
  kind: 'claude' | 'codex';
  sessionId: string;
  machineId: string;
  directory: string;
  backendSessionId: string;
}>;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveSideChatSource(parent: ParentSession): SideChatSource {
  const metadata = record(parent.metadata);
  // Historical Claude sessions predate explicit flavor metadata. Keep the
  // same compatibility contract as the existing UI and resume paths: a
  // Claude backend ID identifies those records without guessing across
  // providers that do advertise a flavor.
  const flavor = nonEmptyString(metadata.flavor)
    ? metadata.flavor
    : nonEmptyString(metadata.claudeSessionId) ? 'claude' : null;
  if (!flavor) {
    throw new Error(`Happy session ${parent.id} is missing provider metadata.`);
  }
  if (flavor !== 'claude' && flavor !== 'codex') {
    throw new Error(
      `Happy session ${parent.id} uses unsupported provider "${flavor}"; side chats require Claude or Codex.`,
    );
  }
  if (!nonEmptyString(metadata.machineId)) {
    throw new Error(`Happy session ${parent.id} is missing owning machine metadata.`);
  }
  if (!nonEmptyString(metadata.path)) {
    throw new Error(`Happy session ${parent.id} is missing working directory metadata.`);
  }

  const backendSessionId = flavor === 'codex'
    ? metadata.codexThreadId
    : metadata.claudeSessionId;
  const backendLabel = flavor === 'codex' ? 'Codex thread' : 'Claude session';
  if (!nonEmptyString(backendSessionId)) {
    throw new Error(`Happy session ${parent.id} is missing its ${backendLabel} ID.`);
  }

  return Object.freeze({
    kind: flavor,
    sessionId: parent.id,
    machineId: metadata.machineId,
    directory: metadata.path,
    backendSessionId,
  });
}

function requireForkedBackendId(
  provider: SideChatSource['kind'],
  result: unknown,
): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`${provider === 'codex' ? 'Codex' : 'Claude'} fork returned an invalid result.`);
  }
  const record = result as Record<string, unknown>;
  const key = provider === 'codex' ? 'newCodexThreadId' : 'newClaudeSessionId';
  if (record.type !== 'success' || !nonEmptyString(record[key])) {
    const detail = nonEmptyString(record.errorMessage) ? `: ${record.errorMessage}` : '';
    throw new Error(`${provider === 'codex' ? 'Codex' : 'Claude'} fork failed${detail}`);
  }
  return record[key];
}

export async function createChildSideChat(
  parentSessionId: string,
  dependencies: SideChatCommandDependencies,
): Promise<CreateChildSideChatResult> {
  const parent = await dependencies.resolveSession(parentSessionId);
  const source = resolveSideChatSource(parent);
  const machine = await dependencies.resolveMachine(source.machineId);

  if (machine.id !== source.machineId) {
    throw new Error(`Owning machine ${source.machineId} for Happy session ${source.sessionId} was not found.`);
  }
  if (!machine.active) {
    throw new Error(`Owning machine ${source.machineId} for Happy session ${source.sessionId} is offline.`);
  }

  const forkResult = source.kind === 'codex'
    ? await dependencies.machineRpc(machine, 'codex-fork-thread', {
      directory: source.directory,
      codexThreadId: source.backendSessionId,
    })
    : await dependencies.machineRpc(machine, 'claude-fork-session', {
      directory: source.directory,
      claudeSessionId: source.backendSessionId,
    });
  const forkedBackendId = requireForkedBackendId(source.kind, forkResult);

  const spawnResult = await dependencies.createMachineSession({
    machine,
    directory: source.directory,
    approvedNewDirectoryCreation: false,
    agent: source.kind,
    ...(source.kind === 'codex'
      ? { resumeCodexThreadId: forkedBackendId }
      : { resumeClaudeSessionId: forkedBackendId }),
    parentSessionId: source.sessionId,
    isSideChat: true,
  });

  if (spawnResult.type === 'error') {
    throw new Error(`Failed to create side chat: ${spawnResult.errorMessage}`);
  }
  if (spawnResult.type === 'requestToApproveDirectoryCreation') {
    throw new Error(
      `Failed to create side chat because the existing parent directory unexpectedly requires creation approval: ${spawnResult.directory}`,
    );
  }
  if (!nonEmptyString(spawnResult.sessionId)) {
    throw new Error('Side-chat spawn returned an invalid Happy session ID.');
  }

  return { sessionId: spawnResult.sessionId };
}

export function sideChatHelp(): string {
  return `happy session side-chat

Usage:
  happy session side-chat create <parent-session-id> [--json]
  happy session side-chat list <parent-session-id> [--json]
  happy session side-chat status <child-session-id> [--json]
  happy session side-chat stop <child-session-id> [--json]
  happy session side-chat close <child-session-id> [--json]
  happy session side-chat close <parent-session-id> --all [--json]
  happy session side-chat reopen <child-session-id> [--json]
  happy session side-chat resume <child-session-id> [--json]

Legacy create syntax remains supported:
  happy session side-chat <parent-session-id> [--json]

All lifecycle actions run through the parent machine's local daemon. Close
stops the provider, deactivates the server session, archives encrypted
lifecycle metadata, and reads the final state back. Reopen resumes the same
Happy session and preserves its parent lineage.
`;
}

export function parseSideChatLifecycleRequest(args: string[]): {
  request: SideChatLifecycleRequest;
  json: boolean;
} {
  const json = args.includes('--json');
  const all = args.includes('--all');
  const positional = args.filter((arg) => arg !== '--json' && arg !== '--all');
  const unknownOption = positional.find((arg) => arg.startsWith('-'));
  if (unknownOption) {
    throw new Error(`Unknown side-chat option: ${unknownOption}`);
  }
  if (positional.length === 0) {
    throw new Error('Usage: happy session side-chat <action> <session-id> [--json]');
  }

  const [candidateAction, ...ids] = positional;
  const action = candidateAction === 'resume' ? 'reopen' : candidateAction;
  const knownAction = ['create', 'list', 'status', 'stop', 'close', 'reopen', 'close-all'].includes(action);
  if (!knownAction) {
    if (all || ids.length > 0 || !candidateAction.trim()) {
      throw new Error(`Unknown side-chat action: ${candidateAction}`);
    }
    return { request: { action: 'create', parentSessionId: candidateAction }, json };
  }
  if (ids.length !== 1 || !ids[0].trim()) {
    throw new Error(`Usage: happy session side-chat ${action} <session-id> [--json]`);
  }
  const id = ids[0];
  if (action === 'close' && all) {
    return { request: { action: 'close-all', parentSessionId: id }, json };
  }
  if (all) {
    throw new Error('--all is supported only with the close action');
  }
  if (action === 'create' || action === 'list' || action === 'close-all') {
    return { request: { action, parentSessionId: id }, json };
  }
  return {
    request: { action: action as 'status' | 'stop' | 'close' | 'reopen', sessionId: id },
    json,
  };
}

export function formatSideChatLifecycleReceipt(receipt: SideChatLifecycleReceipt): string {
  if (receipt.type === 'side-chat-list') {
    const rows = receipt.children.map((child) => (
      `${child.sessionId}\t${child.status}\t${child.active ? 'active' : 'inactive'}\t${child.resumable ? 'resumable' : 'not-resumable'}`
    ));
    const failures = receipt.failures.map((failure) => (
      `${failure.sessionId}\tfailed\t${failure.phase}\t${failure.message}`
    ));
    return [
      `Side chats for ${receipt.parentSessionId}: ${receipt.openCount} open, ${receipt.archivedCount} archived`,
      'SESSION\tSTATUS\tSERVER\tRESUME',
      ...rows,
      ...failures,
    ].join('\n');
  }
  if (receipt.type === 'side-chat-close-all') {
    return [
      `Closed ${receipt.closed}/${receipt.total} side chats for ${receipt.parentSessionId}`,
      ...receipt.children.map((child) => (
        `${child.sessionId ?? '-'}\t${child.success ? 'closed' : 'failed'}\t${child.child?.status ?? 'unknown'}`
      )),
    ].join('\n');
  }
  const child = receipt.child;
  const label = receipt.action === 'create' ? 'Created' : receipt.action[0].toUpperCase() + receipt.action.slice(1);
  const summary = child
    ? `${label} side chat ${child.sessionId}: ${child.status} (${child.active ? 'active' : 'inactive'})`
    : `${label} side chat ${receipt.sessionId ?? '-'}: failed`;
  const failures = receipt.phases
    .filter((phase) => phase.status === 'failed')
    .map((phase) => `${phase.phase}: ${phase.message ?? 'failed'}`);
  return [summary, ...failures].join('\n');
}

export async function handleSideChatCommand(
  args: string[],
  dependencies: SideChatHandlerDependencies,
): Promise<void> {
  const output = dependencies.output ?? console.log;
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    output(sideChatHelp());
    return;
  }

  const { request, json } = parseSideChatLifecycleRequest(args);
  const receipt = await dependencies.execute(request);
  output(json ? JSON.stringify(receipt) : formatSideChatLifecycleReceipt(receipt));
  if (!receipt.success) {
    (dependencies.setExitCode ?? ((code) => { process.exitCode = code; }))(1);
  }
}
