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
  createChild: (parentSessionId: string) => Promise<CreateChildSideChatResult>;
  output?: (value: string) => void;
};

export type CreateChildSideChatResult = {
  sessionId: string;
};

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
  happy session side-chat <parent-session-id> [--json]

Creates a Claude or Codex child side chat from an existing Happy session.
Run it on the parent session's owning machine; it reuses the local daemon and
does not require account-control linking or QR approval.
The child stays beneath its parent in the collapsible side-chat panel.
`;
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

  const json = args.includes('--json');
  const positional = args.filter((arg) => arg !== '--json');
  const unknownOption = positional.find((arg) => arg.startsWith('-'));
  if (unknownOption) {
    throw new Error(`Unknown side-chat option: ${unknownOption}`);
  }
  if (positional.length !== 1 || !positional[0].trim()) {
    throw new Error('Usage: happy session side-chat <parent-session-id> [--json]');
  }

  const result = await dependencies.createChild(positional[0]);
  output(json ? JSON.stringify(result) : result.sessionId);
}
