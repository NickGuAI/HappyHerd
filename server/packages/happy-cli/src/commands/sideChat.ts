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
  modelMode?: string;
  effortLevel?: string;
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

export type SideChatDelegationBrief = Readonly<{
  outcome: string;
  scope: string;
  dependencies: string;
  writeOwnership: string;
  verification: string;
  handoff: string;
}>;

export type SideChatLaunchOptions = Readonly<{
  model?: string;
  effort?: string;
}>;

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
  phase: 'resolve' | 'deliver-brief' | 'stop' | 'archive-metadata' | 'deactivate' | 'resume' | 'readback';
  status: 'succeeded' | 'skipped' | 'failed';
  message?: string;
};

export const SIDE_CHAT_RESOURCE_CPU_SAMPLE_WINDOW_MS = 250;

export type SideChatResourceUsage = {
  status: 'ok' | 'partial' | 'failed';
  sampledAt: string;
  cpu: {
    busyPercent: number | null;
    sampleWindowMs: number;
  };
  loadAverage: {
    oneMinute: number | null;
    fiveMinutes: number | null;
    fifteenMinutes: number | null;
  };
  memory: {
    usedBytes: number | null;
    totalBytes: number | null;
    availableBytes: number | null;
    swapUsedBytes: number | null;
  };
};

export type SideChatLifecycleRequest =
  | {
    action: 'create';
    parentSessionId: string;
    brief: SideChatDelegationBrief | null;
    launch?: SideChatLaunchOptions;
  }
  | { action: 'list'; parentSessionId: string }
  | { action: 'status' | 'stop' | 'close' | 'reopen'; sessionId: string }
  | { action: 'close-all'; parentSessionId: string };

export type SideChatLifecycleAliasRequest = {
  action: 'inspect' | 'pause' | 'resume';
  sessionId: string;
};

export type SideChatLifecycleInput = SideChatLifecycleRequest | SideChatLifecycleAliasRequest;

export function normalizeSideChatLifecycleRequest(
  request: SideChatLifecycleInput,
): SideChatLifecycleRequest {
  switch (request.action) {
    case 'inspect':
      return { action: 'status', sessionId: request.sessionId };
    case 'pause':
      return { action: 'stop', sessionId: request.sessionId };
    case 'resume':
      return { action: 'reopen', sessionId: request.sessionId };
    default:
      return request;
  }
}

type SideChatSingleAction = 'create' | 'status' | 'stop' | 'close' | 'reopen';

export type SideChatSingleReceipt = {
  schemaVersion: 1 | 2;
  type: 'side-chat';
  action: SideChatSingleAction;
  success: boolean;
  parentSessionId: string | null;
  sessionId: string | null;
  child: SideChatStatusReceipt | null;
  phases: SideChatPhaseReceipt[];
  resource?: SideChatResourceUsage;
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

const briefOptions = Object.freeze({
  '--outcome': 'outcome',
  '--scope': 'scope',
  '--dependencies': 'dependencies',
  '--write-ownership': 'writeOwnership',
  '--verification': 'verification',
  '--handoff': 'handoff',
} satisfies Record<string, keyof SideChatDelegationBrief>);

const briefOptionEntries = Object.entries(briefOptions) as Array<
  [keyof typeof briefOptions, keyof SideChatDelegationBrief]
>;

const launchOptions = Object.freeze({
  '--model': 'model',
  '--effort': 'effort',
} satisfies Record<string, keyof SideChatLaunchOptions>);

const launchOptionEntries = Object.entries(launchOptions) as Array<
  [keyof typeof launchOptions, keyof SideChatLaunchOptions]
>;

export function normalizeSideChatDelegationBrief(
  values: Partial<Record<keyof SideChatDelegationBrief, string>>,
): SideChatDelegationBrief {
  const missing = briefOptionEntries
    .filter(([, field]) => !nonEmptyString(values[field]))
    .map(([option]) => option);
  if (missing.length > 0) {
    throw new Error(`Side-chat creation requires: ${missing.join(', ')}`);
  }
  return Object.freeze({
    outcome: values.outcome!.trim(),
    scope: values.scope!.trim(),
    dependencies: values.dependencies!.trim(),
    writeOwnership: values.writeOwnership!.trim(),
    verification: values.verification!.trim(),
    handoff: values.handoff!.trim(),
  });
}

export function sameSideChatDelegationBrief(
  left: SideChatDelegationBrief,
  right: SideChatDelegationBrief,
): boolean {
  return briefOptionEntries.every(([, field]) => left[field] === right[field]);
}

export function sameSideChatLaunchOptions(
  left: SideChatLaunchOptions | undefined,
  right: SideChatLaunchOptions | undefined,
): boolean {
  return left?.model === right?.model && left?.effort === right?.effort;
}

export function formatSideChatDelegationPrompt(
  parentSessionId: string,
  childSessionId: string,
  brief: SideChatDelegationBrief,
): string {
  return `# Delegated delivery brief

You are the Worker Agent in HappyHerd side chat \`${childSessionId}\`, delegated by Orchestrating Agent session \`${parentSessionId}\`. The Human interacts directly with the Main Agent. A provider-native subagent is the default inline fan-out for bounded parallel work; this HappyHerd side chat is a durable, visible, resumable child conversation with stable parent lineage.

## Outcome

${brief.outcome}

## Scope

${brief.scope}

## Dependencies

${brief.dependencies}

## Write ownership

${brief.writeOwnership}

## Verification

${brief.verification}

## Handoff

${brief.handoff}

Execute only this brief. If you become an Orchestrating Agent, explicitly create each delegated task and remain accountable for every direct child and the integrated result. Do not create another HappyHerd side chat unless the Human or Main Agent explicitly requests it. Do not stop, close, reopen, or otherwise manage this side chat; its Orchestrating Agent owns that lifecycle.

Your final handoff must state the result, exact verification evidence, blockers, and remaining work.`;
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
  launch?: SideChatLaunchOptions,
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
    ...(launch?.model ? { modelMode: launch.model } : {}),
    ...(launch?.effort ? { effortLevel: launch.effort } : {}),
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
  return `happyherd session side-chat

Usage:
  happyherd session side-chat create <parent-session-id> \\
    --outcome <text> --scope <text> --dependencies <text> \\
    --write-ownership <text> --verification <text> --handoff <text> \\
    [--model <model>] [--effort <effort>] [--json]
  happyherd session side-chat list <parent-session-id> [--json]
  happyherd session side-chat status <child-session-id> [--json]
  happyherd session side-chat inspect <child-session-id> [--json]
  happyherd session side-chat stop <child-session-id> [--json]
  happyherd session side-chat pause <child-session-id> [--json]
  happyherd session side-chat close <child-session-id> [--json]
  happyherd session side-chat close <parent-session-id> --all [--json]
  happyherd session side-chat reopen <child-session-id> [--json]
  happyherd session side-chat resume <child-session-id> [--json]

The parent-id shorthand remains supported when all six brief options are supplied:
  happyherd session side-chat <parent-session-id> <brief-options> \
    [--model <model>] [--effort <effort>] [--json]

Optional --model and --effort values are validated against the parent machine's
current provider catalog before the child is forked or started.

All lifecycle actions run through the parent machine's local daemon. Close
stops the provider, deactivates the server session, archives encrypted
lifecycle metadata, and reads the final state back. Reopen resumes the same
Happy session and preserves its parent lineage. Inspect, pause, and resume are
aliases for status, stop, and reopen; receipts use the canonical action names.
`;
}

export function parseSideChatLifecycleRequest(args: string[]): {
  request: SideChatLifecycleRequest;
  json: boolean;
} {
  let json = false;
  let all = false;
  const positional: string[] = [];
  const briefValues: Partial<Record<keyof SideChatDelegationBrief, string>> = {};
  const launchValues: Partial<Record<keyof SideChatLaunchOptions, string>> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--all') {
      all = true;
      continue;
    }
    const briefField = briefOptions[argument as keyof typeof briefOptions];
    const launchField = launchOptions[argument as keyof typeof launchOptions];
    if (briefField || launchField) {
      const existingValue = briefField
        ? briefValues[briefField]
        : launchValues[launchField!];
      if (existingValue !== undefined) {
        throw new Error(`Duplicate side-chat option: ${argument}`);
      }
      const value = args[index + 1];
      const valueIsOption = value === '--json'
        || value === '--all'
        || Object.prototype.hasOwnProperty.call(briefOptions, value)
        || Object.prototype.hasOwnProperty.call(launchOptions, value);
      if (!nonEmptyString(value) || valueIsOption) {
        throw new Error(`Side-chat option ${argument} requires a non-empty value`);
      }
      if (briefField) {
        briefValues[briefField] = value;
      } else {
        launchValues[launchField!] = value.trim();
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) {
      throw new Error(`Unknown side-chat option: ${argument}`);
    }
    positional.push(argument);
  }
  if (positional.length === 0) {
    throw new Error('Usage: happyherd session side-chat <action> <session-id> [--json]');
  }

  const launch = launchOptionEntries.some(([, field]) => launchValues[field] !== undefined)
    ? Object.freeze({
      ...(launchValues.model ? { model: launchValues.model } : {}),
      ...(launchValues.effort ? { effort: launchValues.effort } : {}),
    })
    : undefined;

  const [candidateAction, ...ids] = positional;
  const action = candidateAction === 'inspect'
    ? 'status'
    : candidateAction === 'pause'
      ? 'stop'
      : candidateAction === 'resume'
        ? 'reopen'
        : candidateAction;
  const knownAction = ['create', 'list', 'status', 'stop', 'close', 'reopen', 'close-all'].includes(action);
  if (!knownAction) {
    if (all || ids.length > 0 || !candidateAction.trim()) {
      throw new Error(`Unknown side-chat action: ${candidateAction}`);
    }
    return {
      request: {
        action: 'create',
        parentSessionId: candidateAction,
        brief: normalizeSideChatDelegationBrief(briefValues),
        ...(launch ? { launch } : {}),
      },
      json,
    };
  }
  if (ids.length !== 1 || !ids[0].trim()) {
    throw new Error(`Usage: happyherd session side-chat ${action} <session-id> [--json]`);
  }
  const id = ids[0];
  if (action !== 'create' && Object.keys(briefValues).length > 0) {
    throw new Error('Delegation brief options are supported only with the create action');
  }
  if (action !== 'create' && launch) {
    throw new Error('Launch options are supported only with the create action');
  }
  if (action === 'close' && all) {
    return { request: { action: 'close-all', parentSessionId: id }, json };
  }
  if (all) {
    throw new Error('--all is supported only with the close action');
  }
  if (action === 'create') {
    return {
      request: {
        action,
        parentSessionId: id,
        brief: normalizeSideChatDelegationBrief(briefValues),
        ...(launch ? { launch } : {}),
      },
      json,
    };
  }
  if (action === 'list' || action === 'close-all') {
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
  const resource = receipt.action === 'create' && receipt.resource
    ? formatSideChatResourceUsage(receipt.resource)
    : [];
  return [summary, ...resource, ...failures].join('\n');
}

function formatSideChatResourceUsage(resource: SideChatResourceUsage): string[] {
  const metric = (value: number | null, suffix = '') => (
    value === null ? 'unavailable' : `${value}${suffix}`
  );
  const bytes = (value: number | null) => (
    value === null ? 'unavailable' : `${(value / (1024 ** 3)).toFixed(2)} GiB`
  );
  return [
    `Resources (${resource.status}, sampled ${resource.sampledAt})`,
    `  CPU: ${metric(resource.cpu.busyPercent, '%')} busy over ${resource.cpu.sampleWindowMs} ms; load ${metric(resource.loadAverage.oneMinute)} / ${metric(resource.loadAverage.fiveMinutes)} / ${metric(resource.loadAverage.fifteenMinutes)}`,
    `  RAM: ${bytes(resource.memory.usedBytes)} used / ${bytes(resource.memory.totalBytes)} total; ${bytes(resource.memory.availableBytes)} available`,
    `  Swap: ${bytes(resource.memory.swapUsedBytes)} used`,
  ];
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
