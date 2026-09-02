import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import type { Session as ApiSession, Metadata } from '@/api/types';
import type { AgentMessage } from '@/agent/core';
import { AcpBackend, type AcpPermissionHandler } from './AcpBackend';
import { DefaultTransport } from '@/agent/transport';
import { AcpSessionManager } from './AcpSessionManager';
import type { SessionEnvelope } from '@slopus/happy-wire';
import { logger } from '@/ui/logger';
import { MessageQueue2, queueMessageIdsForResume } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { Credentials, readSettings } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/run';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { decodeBase64, encodeBase64 } from '@/api/encryption';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { startHappyServer } from '@/claude/utils/startHappyServer';
import { projectPath } from '@/projectPath';
import { BasePermissionHandler, type PermissionResult } from '@/utils/BasePermissionHandler';
import { connectionState } from '@/utils/serverConnectionErrors';
import {
  extractConfigOptionsFromPayload,
  extractCurrentModeIdFromPayload,
  extractModeStateFromPayload,
  extractModelStateFromPayload,
  mergeAcpSessionConfigIntoMetadata,
} from './sessionConfigMetadata';
import { sanitizeGrokChildEnvironment } from './acpAgentConfig';
import type { InitializeResponse, SessionConfigOption, SessionModeState, SessionModelState, StopReason } from '@agentclientprotocol/sdk';
import { classifyGrokHardLimit } from '@/credentialPool/providerLimits';
import { reportProviderHardLimitOnce } from '@/credentialPool/providerLimitNotice';
import { persistActiveGrokCredential } from '@/credentialPool/grokAuth';
import { redactAcpImageDataForLogging } from '@/sessionProtocol/providerOutputImages';

const ACP_EVENT_PREVIEW_CHARS = 240;
const ACP_RAW_PREVIEW_CHARS = 2000;
const ACP_COLOR_RESET = '\u001b[0m';
const ACP_LOG_COLORS = {
  muted: '\u001b[90m',
  error: '\u001b[31m',
  incoming: '\u001b[32m',
  outgoing: '\u001b[34m',
  tool: '\u001b[38;5;208m',
} as const;

type AcpLogKind = keyof typeof ACP_LOG_COLORS;
type AcpFormattedLog = {
  kind: AcpLogKind;
  text: string;
};

function shouldUseColoredAcpLogs(): boolean {
  if (process.env.FORCE_COLOR === '0') {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined) {
    return true;
  }
  return process.stdout.isTTY === true || process.stderr.isTTY === true;
}

function formatAcpTime(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function colorizeAcpLine(kind: AcpLogKind, line: string): string {
  if (!shouldUseColoredAcpLogs()) {
    return line;
  }
  return `${ACP_LOG_COLORS[kind]}${line}${ACP_COLOR_RESET}`;
}

function logAcp(kind: AcpLogKind, message: string): void {
  const line = `[${formatAcpTime()}] ${message}`;
  console.log(colorizeAcpLine(kind, line));
}

function errorLogSummary(error: unknown): Record<string, string | number> {
  if (typeof error === 'string') return { message: error.slice(0, 500) };
  if (!error || typeof error !== 'object') return { message: 'Unknown error' };

  const record = error as Record<string, unknown>;
  const response = record.response && typeof record.response === 'object'
    ? record.response as Record<string, unknown>
    : null;
  const summary: Record<string, string | number> = {};
  if (typeof record.name === 'string') summary.name = record.name;
  if (typeof record.message === 'string') summary.message = record.message.slice(0, 500);
  if (typeof record.code === 'string') summary.code = record.code;
  const status = typeof record.status === 'number' ? record.status : response?.status;
  if (typeof status === 'number') summary.status = status;
  return Object.keys(summary).length > 0 ? summary : { message: 'Unknown error' };
}

function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateForConsole(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function formatUnknownForConsole(value: unknown, limit: number): string {
  let serialized = '';
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
  }
  return truncateForConsole(toSingleLine(serialized), limit);
}

function formatTextForConsole(text: string): string {
  return JSON.stringify(truncateForConsole(toSingleLine(text), ACP_EVENT_PREVIEW_CHARS));
}

function formatOptionalDetail(text: string | null | undefined, limit = ACP_EVENT_PREVIEW_CHARS): string {
  if (!text) {
    return '';
  }
  return ` - ${truncateForConsole(toSingleLine(text), limit)}`;
}

function extractThinkingText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object' && typeof (payload as { text?: unknown }).text === 'string') {
    return (payload as { text: string }).text;
  }
  return '';
}

function formatAcpMessageForFrontend(agentName: string, msg: AgentMessage, detailed: boolean): AcpFormattedLog | null {
  switch (msg.type) {
    case 'status':
      return null;
    case 'model-output': {
      const text = msg.textDelta ?? msg.fullText ?? '';
      return {
        kind: 'outgoing',
        text: `Outgoing message: ${formatTextForConsole(text)}`,
      };
    }
    case 'model-output-image':
      return {
        kind: 'outgoing',
        text: `Outgoing image: name=${msg.name} mimeType=${msg.mimeType} bytes=${msg.data.length}`,
      };
    case 'tool-call':
      return {
        kind: 'tool',
        text: `Tool: ${msg.toolName} started (callId=${msg.callId})`,
      };
    case 'tool-result':
      return {
        kind: 'tool',
        text: `Tool: ${msg.toolName} completed (callId=${msg.callId})`,
      };
    case 'permission-request':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing permission request from ${agentName}: id=${msg.id} reason=${msg.reason}`,
      };
    case 'permission-response':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing permission response from ${agentName}: id=${msg.id} approved=${msg.approved}`,
      };
    case 'fs-edit':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing fs edit from ${agentName}: description=${formatTextForConsole(msg.description)}`,
      };
    case 'terminal-output':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing terminal output from ${agentName}: text=${formatTextForConsole(msg.data)}`,
      };
    case 'event': {
      if (msg.name === 'thinking') {
        const thinkingText = extractThinkingText(msg.payload);
        return {
          kind: 'muted',
          text: `Thinking: ${formatTextForConsole(thinkingText)}`,
        };
      }
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing event from ${agentName}: name=${msg.name} payload=${formatUnknownForConsole(msg.payload, ACP_EVENT_PREVIEW_CHARS)}`,
      };
    }
    case 'token-count':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing token count from ${agentName}: data=${formatUnknownForConsole(msg, ACP_EVENT_PREVIEW_CHARS)}`,
      };
    case 'exec-approval-request':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing exec approval request from ${agentName}: callId=${msg.call_id}`,
      };
    case 'patch-apply-begin':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing patch apply begin from ${agentName}: callId=${msg.call_id} autoApproved=${msg.auto_approved === true}`,
      };
    case 'patch-apply-end':
      if (!detailed) {
        return null;
      }
      return {
        kind: 'muted',
        text: `Outgoing patch apply end from ${agentName}: callId=${msg.call_id} success=${msg.success}`,
      };
    default:
      return null;
  }
}

function formatEnvelopeForServerLog(agentName: string, envelope: SessionEnvelope): AcpFormattedLog {
  if (envelope.ev.t === 'text') {
    const thinkingPrefix = envelope.ev.thinking ? 'thinking' : 'text';
    return {
      kind: 'incoming',
      text: `Incoming ${thinkingPrefix} prompt for ${agentName}: ${formatUnknownForConsole(envelope.ev.text, ACP_EVENT_PREVIEW_CHARS)}`,
    };
  }
  if (envelope.ev.t === 'tool-call-start') {
    return {
      kind: 'tool',
      text: `Tool start sent to server from ${agentName}: tool=${envelope.ev.name} callId=${envelope.ev.call} args=${formatUnknownForConsole(envelope.ev.args, ACP_EVENT_PREVIEW_CHARS)}`,
    };
  }
  if (envelope.ev.t === 'tool-call-end') {
    return {
      kind: 'tool',
      text: `Tool end sent to server from ${agentName}: callId=${envelope.ev.call}`,
    };
  }
  if (envelope.ev.t === 'turn-start') {
    return {
      kind: 'incoming',
      text: `Incoming turn start for ${agentName}`,
    };
  }
  if (envelope.ev.t === 'turn-end') {
    return {
      kind: 'incoming',
      text: `Incoming turn end for ${agentName}: status=${envelope.ev.status}`,
    };
  }
  return {
    kind: 'incoming',
    text: `Incoming ${envelope.ev.t} for ${agentName}: ${formatUnknownForConsole(envelope.ev, ACP_EVENT_PREVIEW_CHARS)}`,
  };
}

type AcpSwitchMode = {
  permissionMode?: string;
  model?: string | null;
  effort?: string | null;
};

type AcpSelectableOption = {
  code: string;
  value: string;
};

type AcpConfigSelector = {
  configId: string;
  currentCode: string;
  options: AcpSelectableOption[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function generatedImageMapping(result: unknown): { providerPath: string; pseudoPath: string } | null {
  if (!isRecord(result) || Array.isArray(result) || result.type !== 'ImageEdit') return null;
  const { path, session_folder: sessionFolder, filename } = result;
  if (typeof path !== 'string' || path.length === 0) return null;
  if (typeof sessionFolder !== 'string' || typeof filename !== 'string') return null;
  const safeSegment = (segment: string) => (
    segment !== '.'
    && segment !== '..'
    && /^[a-zA-Z0-9._-]+$/.test(segment)
  );
  const safeFolder = sessionFolder.length <= 255
    && sessionFolder.split('/').every(safeSegment);
  const pseudoPath = `${sessionFolder}/${filename}`;
  if (
    !safeFolder
    || !safeSegment(filename)
    || !/\.(?:png|jpe?g)$/i.test(filename)
    || pseudoPath.length > 255
  ) return null;
  return { providerPath: path, pseudoPath };
}

function imageNameMatchesMimeType(name: string, mimeType: 'image/png' | 'image/jpeg'): boolean {
  return mimeType === 'image/png' ? /\.png$/i.test(name) : /\.jpe?g$/i.test(name);
}

function isSelectValue(value: unknown): value is { value: string; name: string } {
  return isRecord(value) && typeof value.value === 'string' && typeof value.name === 'string';
}

function isSelectGroup(value: unknown): value is { options: unknown[] } {
  return isRecord(value) && Array.isArray(value.options);
}

function flattenSelectOptions(options: unknown): AcpSelectableOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  const flattened: AcpSelectableOption[] = [];

  for (const entry of options) {
    if (isSelectValue(entry)) {
      flattened.push({ code: entry.value, value: entry.name });
      continue;
    }
    if (isSelectGroup(entry)) {
      for (const grouped of entry.options) {
        if (!isSelectValue(grouped)) {
          continue;
        }
        flattened.push({ code: grouped.value, value: grouped.name });
      }
    }
  }

  return flattened;
}

function extractConfigSelector(
  configOptions: SessionConfigOption[],
  category: 'mode' | 'model' | 'thought_level',
  exactCategoryOnly = false,
): AcpConfigSelector | null {
  const optionMatchesCategory = (option: SessionConfigOption): boolean => {
    if (exactCategoryOnly) {
      return option.category === category;
    }
    if (option.category !== undefined && option.category !== null) {
      return option.category === category;
    }
    // Some ACP providers omit category; fallback to id/name heuristics.
    const id = normalizeComparable(option.id);
    const name = normalizeComparable(option.name);
    if (category === 'model') {
      return id.includes('model') || name.includes('model');
    }
    if (category === 'thought_level') {
      return id.includes('effort') || id.includes('reasoning') || id.includes('thought')
        || name.includes('effort') || name.includes('reasoning') || name.includes('thought');
    }
    return id.includes('mode') || id.includes('permission') || name.includes('mode') || name.includes('permission');
  };

  const matches = configOptions.filter((option) => (
    option.type === 'select' && optionMatchesCategory(option)
  ));
  if (exactCategoryOnly && matches.length !== 1) return null;

  for (const option of matches) {
    return {
      configId: option.id,
      currentCode: option.currentValue,
      options: flattenSelectOptions(option.options),
    };
  }
  return null;
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function resolveRequestedCode(options: AcpSelectableOption[], requested: string): string | null {
  for (const option of options) {
    if (option.code === requested || option.value === requested) {
      return option.code;
    }
  }

  const normalizedRequested = normalizeComparable(requested);
  for (const option of options) {
    if (normalizeComparable(option.code) === normalizedRequested || normalizeComparable(option.value) === normalizedRequested) {
      return option.code;
    }
  }

  return null;
}

export function resolveDshModelConfigCode(options: AcpSelectableOption[], requestedModel: string): string | null {
  for (const option of options) {
    try {
      const decoded: unknown = JSON.parse(option.code);
      if (
        Array.isArray(decoded)
        && decoded.length === 2
        && decoded[0] === 'deepseek-official'
        && typeof decoded[1] === 'string'
        && decoded[1] === requestedModel
      ) {
        return option.code;
      }
    } catch {
      // dsh model values are opaque JSON tuples. Ignore malformed provider data.
    }
  }

  return null;
}

function resolveRequestedLegacyModeCode(modes: SessionModeState, requested: string): string | null {
  for (const mode of modes.availableModes) {
    if (mode.id === requested || mode.name === requested) {
      return mode.id;
    }
  }

  const normalizedRequested = normalizeComparable(requested);
  for (const mode of modes.availableModes) {
    if (normalizeComparable(mode.id) === normalizedRequested || normalizeComparable(mode.name) === normalizedRequested) {
      return mode.id;
    }
  }

  return null;
}

function resolveRequestedLegacyModelCode(models: SessionModelState, requested: string): string | null {
  for (const model of models.availableModels) {
    if (model.modelId === requested || model.name === requested) {
      return model.modelId;
    }
  }

  const normalizedRequested = normalizeComparable(requested);
  for (const model of models.availableModels) {
    if (normalizeComparable(model.modelId) === normalizedRequested || normalizeComparable(model.name) === normalizedRequested) {
      return model.modelId;
    }
  }

  return null;
}

function readModelEffortState(
  models: SessionModelState,
  modelId: string,
): { options: AcpSelectableOption[]; currentCode: string | null } {
  const model = models.availableModels.find((candidate) => candidate.modelId === modelId);
  const meta = isRecord(model?._meta) ? model._meta : null;
  const rawOptions = meta && Array.isArray(meta.reasoningEfforts) ? meta.reasoningEfforts : [];
  const options = rawOptions.flatMap((raw): AcpSelectableOption[] => {
    if (!isRecord(raw) || typeof raw.id !== 'string') return [];
    return [{
      code: raw.id,
      value: typeof raw.label === 'string' ? raw.label : raw.id,
    }];
  });
  const advertisedDefault = rawOptions.find((raw) => isRecord(raw) && raw.default === true);
  return {
    options,
    currentCode: typeof meta?.reasoningEffort === 'string'
      ? meta.reasoningEffort
      : isRecord(advertisedDefault) && typeof advertisedDefault.id === 'string'
        ? advertisedDefault.id
        : null,
  };
}

export type AcpPermissionPolicy = 'prompt' | 'approve' | 'deny' | 'cancel';

/** Resolve only launch-time permission policy; ACP plan/build mode remains separate. */
export function resolveAcpPermissionPolicy(
  agentName: string,
  permissionMode: string | undefined,
): AcpPermissionPolicy {
  if (agentName !== 'grok') return 'prompt';
  if (permissionMode === 'bypassPermissions') return 'approve';
  if (permissionMode === 'dontAsk') return 'deny';
  if (
    permissionMode === undefined
    || permissionMode === 'default'
    || permissionMode === 'acceptEdits'
    || permissionMode === 'auto'
    || permissionMode === 'plan'
  ) {
    return 'prompt';
  }
  return 'cancel';
}

class GenericAcpPermissionHandler extends BasePermissionHandler implements AcpPermissionHandler {
  private readonly logPrefix: string;
  private readonly permissionPolicy: AcpPermissionPolicy;

  constructor(session: ApiSessionClient, agentName: string, permissionMode?: string) {
    super(session);
    this.logPrefix = `[${agentName}]`;
    this.permissionPolicy = resolveAcpPermissionPolicy(agentName, permissionMode);
  }

  protected getLogPrefix(): string {
    return this.logPrefix;
  }

  requiresUserInput(): boolean {
    return this.permissionPolicy === 'prompt';
  }

  async handleToolCall(
    toolCallId: string,
    toolName: string,
    input: unknown,
    displayTitle?: string,
  ): Promise<PermissionResult | { decision: 'approved_without_prompt' }> {
    if (this.permissionPolicy === 'approve') {
      return { decision: 'approved_without_prompt' };
    }
    if (this.permissionPolicy === 'deny') {
      return { decision: 'denied' };
    }
    if (this.permissionPolicy === 'cancel') {
      return { decision: 'abort' };
    }

    const pendingTitle = displayTitle?.trim() || toolName;
    return new Promise<PermissionResult>((resolve, reject) => {
      this.pendingRequests.set(toolCallId, {
        resolve,
        reject,
        toolName: pendingTitle,
        input,
      });
      this.addPendingRequestToState(toolCallId, pendingTitle, input);
      logger.debug(`${this.logPrefix} Permission request sent for tool: ${pendingTitle} (${toolCallId})`);
    });
  }
}

function resolveSessionFlavor(agentName: string): 'gemini' | 'grok' | 'dsh' | 'opencode' | 'acp' {
  if (agentName === 'gemini') {
    return 'gemini';
  }
  if (agentName === 'opencode') {
    return 'opencode';
  }
  if (agentName === 'grok') {
    return 'grok';
  }
  if (agentName === 'dsh') {
    return 'dsh';
  }
  return 'acp';
}

function normalizeAcpCapabilities(initialize: InitializeResponse): NonNullable<Metadata['acpCapabilities']> {
  const capabilities = initialize.agentCapabilities;
  const prompt = capabilities?.promptCapabilities;
  return {
    loadSession: capabilities?.loadSession === true,
    prompt: {
      image: prompt?.image === true,
    },
  };
}

function turnStatusForStopReason(stopReason: StopReason): 'completed' | 'cancelled' | 'failed' {
  if (stopReason === 'cancelled') return 'cancelled';
  if (stopReason === 'refusal') return 'failed';
  return 'completed';
}

export async function runAcp(opts: {
  credentials: Credentials;
  agentName: string;
  command: string;
  args: string[];
  startedBy?: 'daemon' | 'terminal';
  verbose?: boolean;
  permissionMode?: string;
  model?: string;
  effort?: string;
  resumeSessionId?: string;
}): Promise<void> {
  const verbose = opts.verbose === true;
  const sessionTag = randomUUID();
  connectionState.setBackend(opts.agentName);

  const api = await ApiClient.create(opts.credentials);
  const settings = await readSettings();
  if (!settings?.machineId) {
    throw new Error('No machine ID found in settings');
  }

  await api.getOrCreateMachine({
    machineId: settings.machineId,
    metadata: initialMachineMetadata,
  });

  const { state, metadata } = createSessionMetadata({
    flavor: resolveSessionFlavor(opts.agentName),
    machineId: settings.machineId,
    startedBy: opts.startedBy,
    sandbox: settings.sandboxConfig,
    ...((opts.agentName === 'grok' || opts.agentName === 'dsh') && opts.startedBy !== 'daemon'
      ? {
        spawnSettings: {
          provider: opts.agentName,
          model: opts.model ?? null,
          effort: opts.effort ?? null,
          permission: opts.permissionMode ?? null,
        },
      }
      : {}),
  });
  // A reconnect loads the old encrypted metadata before the provider process
  // is ready. Keep the newly validated daemon launch receipt locally, but do
  // not publish it until the named first-class ACP provider confirms startup.
  const pendingLaunchReceipt = metadata.spawnSettings;
  const reconnectSessionId = process.env.HAPPY_RECONNECT_SESSION_ID;
  const reconnectKeyBase64 = process.env.HAPPY_RECONNECT_ENCRYPTION_KEY;
  const reconnectVariant = process.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT as 'legacy' | 'dataKey' | undefined;
  let response: ApiSession | null;
  if (reconnectSessionId && reconnectKeyBase64 && reconnectVariant) {
    response = await api.refreshSessionForReconnect({
      id: reconnectSessionId,
      seq: Number.parseInt(process.env.HAPPY_RECONNECT_SEQ || '0', 10),
      encryptionKey: decodeBase64(reconnectKeyBase64),
      encryptionVariant: reconnectVariant,
      metadata,
      metadataVersion: Number.parseInt(process.env.HAPPY_RECONNECT_METADATA_VERSION || '0', 10),
      agentState: state,
      agentStateVersion: Number.parseInt(process.env.HAPPY_RECONNECT_AGENT_STATE_VERSION || '0', 10),
    });
    Object.assign(metadata, response.metadata);
    if (pendingLaunchReceipt) {
      metadata.spawnSettings = pendingLaunchReceipt;
    }
  } else {
    response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });
  }
  if (response) {
    logAcp('muted', `Happy Session ID: ${response.id}`);
  }

  let session: ApiSessionClient;
  let permissionHandler: GenericAcpPermissionHandler;
  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: (newSession) => {
      session = newSession;
      if (permissionHandler) {
        permissionHandler.updateSession(newSession);
      }
    },
  });
  session = initialSession;

  const reconnectQueueMessageIds = reconnectSessionId && response
    ? Array.from(new Set([
      ...queueMessageIdsForResume(response.agentState?.messageQueue),
      ...(process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID
        ? [process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID]
        : []),
    ]))
    : [];
  if (reconnectSessionId) {
    session.suppressNextArchiveSignal();
    session.skipExistingMessages(reconnectQueueMessageIds, response?.seq ?? Number.MAX_SAFE_INTEGER);
    session.updateMetadata((currentMetadata) => ({
      ...currentMetadata,
      lifecycleState: 'running',
      lifecycleStateSince: Date.now(),
      archivedBy: undefined,
      archiveReason: undefined,
    }));
  }

  if (response) {
    try {
      await notifyDaemonSessionStarted(response.id, response.metadata, {
        encryptionKey: encodeBase64(response.encryptionKey),
        encryptionVariant: response.encryptionVariant,
        seq: response.seq,
        metadataVersion: response.metadataVersion,
        agentStateVersion: response.agentStateVersion,
      });
    } catch (error) {
      logger.debug('[acp] Failed to report session to daemon:', error);
    }
  }

  permissionHandler = new GenericAcpPermissionHandler(session, opts.agentName, opts.permissionMode);
  // Drop any permission requests left in agent state from a previous CLI
  // process that died while a tool prompt was open — see the matching
  // call in claudeRemoteLauncher for the full rationale.
  permissionHandler.reset('Previous CLI process exited before responding');
  const sessionManager = new AcpSessionManager();
  const messageQueue = new MessageQueue2<AcpSwitchMode>((mode) => hashObject(mode));
  messageQueue.restorePendingQueueMessageIds(reconnectQueueMessageIds);
  messageQueue.setOnQueueStateChange((messageQueueState) => {
    session.updateAgentState((currentState) => ({ ...currentState, messageQueue: messageQueueState }));
  });
  session.updateAgentState((currentState) => ({
    ...currentState,
    messageQueue: messageQueue.getQueueState(),
  }));
  // GrokBuild permission modes are process launch flags. Its ACP operating
  // mode is a separate capability and must not emulate a live permission
  // switch from Happy message metadata.
  const supportsRuntimePermissionSelection = opts.agentName !== 'grok';
  let currentPermissionMode: string | undefined = supportsRuntimePermissionSelection
    ? opts.permissionMode
    : undefined;
  let currentModel: string | null | undefined = opts.model;
  let currentEffort: string | null | undefined = opts.effort;
  let modeSelector: AcpConfigSelector | null = null;
  let modelSelector: AcpConfigSelector | null = null;
  let effortSelector: AcpConfigSelector | null = null;
  let legacyModes: SessionModeState | null = null;
  let legacyModels: SessionModelState | null = null;
  let sawSlashCommands = false;
  let sawModes = false;
  let sawModels = false;
  let runtimeAcpCapabilities = response?.metadata?.acpCapabilities;

  const happyServer = await startHappyServer(session);
  const mcpServers = {
    happy: {
      command: join(projectPath(), 'bin', 'happy-mcp.mjs'),
      args: ['--url', happyServer.url],
    },
  };

  const backend = new AcpBackend({
    agentName: opts.agentName,
    cwd: process.cwd(),
    command: opts.command,
    args: opts.args,
    mcpServers,
    permissionHandler,
    transportHandler: new DefaultTransport(opts.agentName),
    verbose,
    loadSessionId: opts.resumeSessionId ?? response?.metadata?.acpSessionId,
    processEnv: opts.agentName === 'grok' ? sanitizeGrokChildEnvironment(process.env) : undefined,
  });

  let thinking = false;
  let acpSessionId: string | null = null;
  let shouldExit = false;
  let abortController = new AbortController();
  const stopRunnerFromBackendStatus = (status: 'error' | 'stopped', detail?: string) => {
    const reason = detail
      ? `${opts.agentName} backend ${status}: ${detail}`
      : `${opts.agentName} backend ${status}`;
    logger.debug(`[${opts.agentName}] ${reason}; stopping ACP runner`);
    shouldExit = true;
    messageQueue.close();
  };

  const sendEnvelopes = (envelopes: SessionEnvelope[]) => {
    for (const envelope of envelopes) {
      if (verbose) {
        const formatted = formatEnvelopeForServerLog(opts.agentName, envelope);
        logAcp('muted', formatted.text);
      }
      session.sendSessionProtocolMessage(envelope);
      if (verbose) {
        logAcp('muted', `Incoming raw envelope for ${opts.agentName}: ${formatUnknownForConsole(redactAcpImageDataForLogging(envelope), ACP_RAW_PREVIEW_CHARS)}`);
      }
    }
  };

  let protocolWork = Promise.resolve();
  const observedTurnImages: Array<{
    digest: string;
    mimeType: 'image/png' | 'image/jpeg';
    name: string;
    sourceCallId?: string;
    sourceUri?: string;
    crossSourceMatched: boolean;
  }> = [];
  const generatedImageNamesByProviderPath = new Map<string, Set<string>>();
  const generatedImagePathsByPseudoName = new Map<string, Set<string>>();
  const correlatedImageNameByCallId = new Map<string, string>();
  const imageEditCallIds = new Set<string>();
  const enqueueProtocolMessage = (msg: AgentMessage) => {
    protocolWork = protocolWork.then(async () => {
      if (msg.type === 'tool-call' && msg.args.variant === 'ImageEdit' && opts.agentName === 'grok') {
        imageEditCallIds.add(msg.callId);
      } else if (
        msg.type === 'tool-result'
        && msg.error === undefined
        && opts.agentName === 'grok'
        && imageEditCallIds.has(msg.callId)
      ) {
        const mapping = generatedImageMapping(msg.result);
        if (mapping) {
          const names = generatedImageNamesByProviderPath.get(mapping.providerPath) ?? new Set<string>();
          names.add(mapping.pseudoPath);
          generatedImageNamesByProviderPath.set(mapping.providerPath, names);
          const paths = generatedImagePathsByPseudoName.get(mapping.pseudoPath) ?? new Set<string>();
          paths.add(mapping.providerPath);
          generatedImagePathsByPseudoName.set(mapping.pseudoPath, paths);
        }
      } else if (
        msg.type === 'tool-call'
        && opts.agentName === 'grok'
        && msg.args.variant === 'ReadFile'
        && typeof msg.args.target_file === 'string'
      ) {
        const exactNames = generatedImageNamesByProviderPath.get(msg.args.target_file);
        if (exactNames?.size === 1) {
          const [exactName] = exactNames;
          const reversePaths = exactName ? generatedImagePathsByPseudoName.get(exactName) : undefined;
          if (exactName && reversePaths?.size === 1 && reversePaths.has(msg.args.target_file)) {
            correlatedImageNameByCallId.set(msg.callId, exactName);
          }
        }
      }

      let persistedMessage = msg;
      if (msg.type === 'model-output-image' && msg.sourceCallId && !msg.sourceUri) {
        const exactName = correlatedImageNameByCallId.get(msg.sourceCallId);
        if (exactName && imageNameMatchesMimeType(exactName, msg.mimeType)) {
          persistedMessage = { ...msg, name: exactName };
        }
      }

      sendEnvelopes(sessionManager.mapMessage(persistedMessage));
      if (persistedMessage.type !== 'model-output-image') return;

      const digest = createHash('sha256').update(persistedMessage.data).digest('hex');
      const exactDuplicate = observedTurnImages.some((prior) => (
        prior.mimeType === persistedMessage.mimeType
        && prior.digest === digest
        && prior.name === persistedMessage.name
      ));
      if (exactDuplicate) return;

      const crossSourceMatch = observedTurnImages.find((prior) => (
        prior.mimeType === persistedMessage.mimeType
        && prior.digest === digest
        && !prior.crossSourceMatched
        && prior.sourceCallId !== undefined
        && persistedMessage.sourceCallId === undefined
        && (prior.sourceUri === undefined || persistedMessage.sourceUri === undefined)
      ));
      const imageRecord = {
        digest,
        mimeType: persistedMessage.mimeType,
        name: persistedMessage.name,
        ...(persistedMessage.sourceCallId ? { sourceCallId: persistedMessage.sourceCallId } : {}),
        ...(persistedMessage.sourceUri ? { sourceUri: persistedMessage.sourceUri } : {}),
        crossSourceMatched: crossSourceMatch !== undefined,
      };
      observedTurnImages.push(imageRecord);
      if (crossSourceMatch) {
        crossSourceMatch.crossSourceMatched = true;
        return;
      }
      try {
        const envelope = await session.uploadImageAttachmentEnvelope(
          { data: persistedMessage.data, mimeType: persistedMessage.mimeType, name: persistedMessage.name },
          'agent',
          sessionManager.nextAttachmentEnvelopeOptions(),
        );
        sendEnvelopes([envelope]);
      } catch (error) {
        const failedIndex = observedTurnImages.indexOf(imageRecord);
        if (failedIndex >= 0) observedTurnImages.splice(failedIndex, 1);
        logger.debug(`[${opts.agentName}] Failed to upload ACP agent output image`, {
          name: persistedMessage.name,
          mimeType: persistedMessage.mimeType,
          size: persistedMessage.data.length,
          error: errorLogSummary(error),
        });
      }
    }).catch((error) => {
      logger.debug(`[${opts.agentName}] Failed to persist ACP protocol message`, errorLogSummary(error));
    });
  };

  const switchPermissionModeIfRequested = async (requestedMode: string): Promise<boolean> => {
    if (!requestedMode) {
      return true;
    }

    if (modeSelector) {
      const resolved = resolveRequestedCode(modeSelector.options, requestedMode);
      if (resolved) {
        if (resolved === modeSelector.currentCode) {
          return true;
        }
        const switched = await backend.setSessionConfigOption(modeSelector.configId, resolved);
        if (switched) {
          modeSelector.currentCode = resolved;
          return true;
        }
      }
    }

    if (legacyModes) {
      const resolvedLegacyMode = resolveRequestedLegacyModeCode(legacyModes, requestedMode);
      if (resolvedLegacyMode) {
        if (resolvedLegacyMode === legacyModes.currentModeId) {
          return true;
        }

        const switched = await backend.setSessionMode(resolvedLegacyMode);
        if (switched) {
          legacyModes = {
            ...legacyModes,
            currentModeId: resolvedLegacyMode,
          };
          return true;
        }
      }
    }

    logger.debug(`[${opts.agentName}] Rejecting unsupported ACP permission mode request: ${requestedMode}`);
    return false;
  };

  const switchModelAndEffortIfRequested = async (
    requestedModel: string | null | undefined,
    requestedEffort: string | null | undefined,
  ): Promise<void> => {
    if (!requestedModel && !requestedEffort) return;

    if (opts.agentName === 'dsh') {
      const switchRequiredOption = async (
        selector: AcpConfigSelector | null,
        requested: string | null | undefined,
        dimension: 'model' | 'effort',
      ): Promise<void> => {
        if (!requested) return;
        if (!selector) {
          throw new Error(`dsh did not advertise a ${dimension} config option`);
        }
        const resolved = dimension === 'model'
          ? resolveDshModelConfigCode(selector.options, requested)
          : resolveRequestedCode(selector.options, requested);
        if (!resolved) {
          throw new Error(`Unsupported dsh ${dimension}: ${requested}`);
        }
        if (resolved === selector.currentCode) return;
        const switched = await backend.setSessionConfigOption(selector.configId, resolved);
        if (!switched) {
          throw new Error(`dsh rejected ${dimension}: ${requested}`);
        }
        selector.currentCode = resolved;
      };

      await switchRequiredOption(modelSelector, requestedModel, 'model');
      await switchRequiredOption(effortSelector, requestedEffort, 'effort');
      return;
    }

    if (requestedModel && modelSelector) {
      const resolved = resolveRequestedCode(modelSelector.options, requestedModel);
      if (!resolved) {
        logger.debug(`[${opts.agentName}] Ignoring unknown ACP model request: ${requestedModel}`);
        return;
      }
      if (resolved === modelSelector.currentCode) {
        return;
      }
      const switched = await backend.setSessionConfigOption(modelSelector.configId, resolved);
      if (switched) {
        modelSelector.currentCode = resolved;
        return;
      }
      if (requestedEffort) {
        logger.debug(`[${opts.agentName}] Ignoring effort request because this ACP provider did not advertise Grok model effort metadata`);
      }
      return;
    }

    if (!legacyModels) {
      return;
    }

    const resolvedLegacyModel = requestedModel
      ? resolveRequestedLegacyModelCode(legacyModels, requestedModel)
      : legacyModels.currentModelId;
    if (!resolvedLegacyModel && requestedModel) {
      logger.debug(`[${opts.agentName}] Ignoring unknown ACP legacy model request: ${requestedModel}`);
      return;
    }
    if (!resolvedLegacyModel) {
      logger.debug(`[${opts.agentName}] Ignoring effort request because the ACP session has no current model`);
      return;
    }

    const supportsGrokEffort = opts.agentName === 'grok';
    const effortState = supportsGrokEffort
      ? readModelEffortState(legacyModels, resolvedLegacyModel)
      : { options: [], currentCode: null };
    const resolvedEffort = supportsGrokEffort && requestedEffort
      ? resolveRequestedCode(effortState.options, requestedEffort)
      : null;
    if (supportsGrokEffort && requestedEffort && !resolvedEffort) {
      logger.debug(`[${opts.agentName}] Ignoring unknown ACP effort request: ${requestedEffort}`);
    }

    const modelChanged = resolvedLegacyModel !== legacyModels.currentModelId;
    const effortChanged = resolvedEffort !== null && resolvedEffort !== effortState.currentCode;
    if (!modelChanged && !effortChanged) return;

    const switched = await backend.setSessionModel(
      resolvedLegacyModel,
      supportsGrokEffort ? resolvedEffort ?? undefined : undefined,
    );
    if (switched) {
      legacyModels = {
        ...legacyModels,
        currentModelId: resolvedLegacyModel,
        availableModels: legacyModels.availableModels.map((model) => (
          model.modelId === resolvedLegacyModel && resolvedEffort && isRecord(model._meta)
            ? { ...model, _meta: { ...model._meta, reasoningEffort: resolvedEffort } }
            : model
        )),
      };
      session.updateMetadata((currentMetadata) => ({
        ...mergeAcpSessionConfigIntoMetadata(currentMetadata, { models: legacyModels }, opts.agentName),
      }));
    }
  };

  const onBackendMessage = (msg: AgentMessage) => {
    if (verbose) {
      logAcp('muted', `Outgoing raw backend message from ${opts.agentName}: ${formatUnknownForConsole(redactAcpImageDataForLogging(msg), ACP_RAW_PREVIEW_CHARS)}`);
    }

    if (msg.type === 'event' && msg.name === 'available_commands') {
      const commands = msg.payload as { name: string; description?: string }[];
      const commandNames = commands.map((c) => c.name);
      sawSlashCommands = commands.length > 0;
      if (verbose) {
        logAcp('muted', `Outgoing slash commands from ${opts.agentName} (${commands.length}):`);
        for (const command of commands) {
          logAcp('muted', `  /${command.name}${formatOptionalDetail(command.description, 160)}`);
        }
      }
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        slashCommands: commandNames,
      }));
    }

    if (msg.type === 'event' && msg.name === 'config_options_update') {
      const configOptions = extractConfigOptionsFromPayload(msg.payload);
      if (configOptions) {
        if (verbose) {
          logAcp('muted', `Outgoing config options from ${opts.agentName} (${configOptions.length}):`);
          for (const option of configOptions) {
            if (option.type === 'select') {
              const optionValues = flattenSelectOptions(option.options);
              logAcp('muted', `  config=${option.id} category=${option.category ?? 'unknown'} current=${option.currentValue} options=${optionValues.length}`);
            } else {
              logAcp('muted', `  config=${option.id} type=${option.type} category=${option.category ?? 'unknown'}`);
            }
          }
        }

        const exactDshCategories = opts.agentName === 'dsh';
        modeSelector = extractConfigSelector(configOptions, 'mode', exactDshCategories);
        modelSelector = extractConfigSelector(configOptions, 'model', exactDshCategories);
        effortSelector = extractConfigSelector(configOptions, 'thought_level', exactDshCategories);
        if (verbose) {
          if (modeSelector) {
            sawModes = true;
            logAcp('muted', `Outgoing mode options from ${opts.agentName} (${modeSelector.options.length}), current=${modeSelector.currentCode}:`);
            for (const option of modeSelector.options) {
              logAcp('muted', `  mode=${option.code} label=${option.value}`);
            }
          } else {
            logAcp('muted', `Outgoing mode options from ${opts.agentName}: not reported in config options`);
          }
          if (modelSelector) {
            sawModels = true;
            logAcp('muted', `Outgoing model options from ${opts.agentName} (${modelSelector.options.length}), current=${modelSelector.currentCode}:`);
            for (const option of modelSelector.options) {
              logAcp('muted', `  model=${option.code} label=${option.value}`);
            }
          } else {
            logAcp('muted', `Outgoing model options from ${opts.agentName}: not reported in config options`);
          }
        }
        session.updateMetadata((currentMetadata) =>
          mergeAcpSessionConfigIntoMetadata(currentMetadata, { configOptions }, opts.agentName),
        );
      }
    }

    if (msg.type === 'event' && msg.name === 'modes_update') {
      const modes = extractModeStateFromPayload(msg.payload);
      if (modes) {
        legacyModes = modes;
        sawModes = true;
        if (verbose) {
          logAcp('muted', `Outgoing modes from ${opts.agentName} (${modes.availableModes.length}), current=${modes.currentModeId}:`);
          for (const mode of modes.availableModes) {
            logAcp('muted', `  mode=${mode.id} name=${mode.name}${formatOptionalDetail(mode.description, 160)}`);
          }
        }
        session.updateMetadata((currentMetadata) =>
          mergeAcpSessionConfigIntoMetadata(currentMetadata, { modes }, opts.agentName),
        );
      }
    }

    if (msg.type === 'event' && msg.name === 'models_update') {
      const models = extractModelStateFromPayload(msg.payload);
      if (models) {
        legacyModels = models;
        sawModels = true;
        if (verbose) {
          logAcp('muted', `Outgoing models from ${opts.agentName} (${models.availableModels.length}), current=${models.currentModelId}:`);
          for (const model of models.availableModels) {
            logAcp('muted', `  model=${model.modelId} name=${model.name}`);
          }
        }
        session.updateMetadata((currentMetadata) =>
          mergeAcpSessionConfigIntoMetadata(currentMetadata, { models }, opts.agentName),
        );
      }
    }

    if (msg.type === 'event' && msg.name === 'initialize_response') {
      const initialize = msg.payload as InitializeResponse;
      runtimeAcpCapabilities = normalizeAcpCapabilities(initialize);
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        acpCapabilities: runtimeAcpCapabilities,
      }));
    }

    if (msg.type === 'event' && msg.name === 'current_mode_update') {
      const currentModeId = extractCurrentModeIdFromPayload(msg.payload);
      if (currentModeId) {
        if (modeSelector) {
          modeSelector = {
            ...modeSelector,
            currentCode: currentModeId,
          };
        }
        if (legacyModes) {
          legacyModes = {
            ...legacyModes,
            currentModeId,
          };
        }
        session.updateMetadata((currentMetadata) =>
          mergeAcpSessionConfigIntoMetadata(currentMetadata, { currentModeId }, opts.agentName),
        );
      }
    }

    if (msg.type === 'status') {
      const suffix = msg.detail ? `: ${msg.detail}` : '';
      const statusLine = `Status: ${msg.status}${suffix}`;
      logAcp('muted', statusLine);
      const nextThinking = msg.status === 'running';
      if (thinking !== nextThinking) {
        thinking = nextThinking;
        session.keepAlive(thinking, 'remote');
      }
      if (msg.status === 'error' || msg.status === 'stopped') {
        stopRunnerFromBackendStatus(msg.status, msg.detail);
      }
    }

    const frontendMessage = formatAcpMessageForFrontend(opts.agentName, msg, verbose);
    if (frontendMessage) {
      logAcp(frontendMessage.kind, frontendMessage.text);
    }

    enqueueProtocolMessage(msg);
  };

  backend.onMessage(onBackendMessage);

  session.onUserMessage((message) => {
    if (!message.content.text) {
      return;
    }

    if (supportsRuntimePermissionSelection && typeof message.meta?.permissionMode === 'string') {
      currentPermissionMode = message.meta.permissionMode;
      logger.debug(`[${opts.agentName}] Requested ACP permission mode: ${currentPermissionMode}`);
    }

    if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'model')) {
      currentModel = message.meta.model ?? null;
      logger.debug(`[${opts.agentName}] Requested ACP model: ${currentModel ?? 'null'}`);
    }

    if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'effort')) {
      currentEffort = message.meta.effort ?? null;
      logger.debug(`[${opts.agentName}] Requested ACP effort: ${currentEffort ?? 'null'}`);
    }

    messageQueue.push(message.content.text, {
      permissionMode: currentPermissionMode,
      model: currentModel,
      effort: currentEffort,
    });
  });
  session.keepAlive(thinking, 'remote');

  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 2000);

  async function handleAbort() {
    try {
      permissionHandler.abortAll();
      if (acpSessionId) {
        await backend.cancel(acpSessionId);
      }
      abortController.abort();
    } catch (error) {
      logger.debug(`[${opts.agentName}] Abort failed:`, error);
    } finally {
      abortController = new AbortController();
    }
  }

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    shouldExit = true;
    messageQueue.close();
    await handleAbort();
  });

  try {
    const started = await backend.startSession();
    acpSessionId = started.sessionId;
    if (started.providerSessionId) {
      const confirmedLaunchReceipt = (opts.agentName === 'grok' || opts.agentName === 'dsh') && metadata.spawnSettings
        ? {
          spawnSettings: metadata.spawnSettings,
          permissionMode: metadata.spawnSettings.permission,
        }
        : {};
      Object.assign(metadata, {
        acpSessionId: started.providerSessionId,
        ...(runtimeAcpCapabilities ? { acpCapabilities: runtimeAcpCapabilities } : {}),
        ...confirmedLaunchReceipt,
      });
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        acpSessionId: started.providerSessionId,
        ...(runtimeAcpCapabilities ? { acpCapabilities: runtimeAcpCapabilities } : {}),
        ...confirmedLaunchReceipt,
      }));
      if (response) {
        try {
          await notifyDaemonSessionStarted(response.id, {
            ...response.metadata,
            ...metadata,
          }, {
            encryptionKey: encodeBase64(response.encryptionKey),
            encryptionVariant: response.encryptionVariant,
            seq: response.seq,
            metadataVersion: response.metadataVersion,
            agentStateVersion: response.agentStateVersion,
          });
        } catch (error) {
          logger.debug('[acp] Failed to refresh daemon session metadata:', error);
        }
      }
    }
    if (verbose) {
      if (!sawSlashCommands) {
        logAcp('muted', `Outgoing slash commands from ${opts.agentName}: not reported yet`);
      }
      if (!sawModes) {
        logAcp('muted', `Outgoing modes from ${opts.agentName}: not reported yet`);
      }
      if (!sawModels) {
        logAcp('muted', `Outgoing models from ${opts.agentName}: not reported yet`);
      }
    }

    while (!shouldExit) {
      const waitSignal = abortController.signal;
      const batch = await messageQueue.waitForMessagesAndGetAsString(waitSignal);
      if (!batch) {
        if (shouldExit) {
          break;
        }
        if (waitSignal.aborted) {
          continue;
        }
        break;
      }

      if (!acpSessionId) {
        throw new Error('ACP session is not started');
      }

      logAcp('incoming', `Incoming prompt: ${formatUnknownForConsole(batch.message, ACP_EVENT_PREVIEW_CHARS)}`);
      await protocolWork;
      observedTurnImages.length = 0;
      generatedImageNamesByProviderPath.clear();
      generatedImagePathsByPseudoName.clear();
      correlatedImageNameByCallId.clear();
      imageEditCallIds.clear();
      sendEnvelopes(sessionManager.startTurn());
      try {
        if (supportsRuntimePermissionSelection && typeof batch.mode.permissionMode === 'string' && batch.mode.permissionMode.length > 0) {
          const switched = await switchPermissionModeIfRequested(batch.mode.permissionMode);
          if (!switched) {
            const error = `Unsupported ${opts.agentName} permission mode: ${batch.mode.permissionMode}`;
            session.sendSessionEvent({ type: 'message', message: error });
            await protocolWork;
            sendEnvelopes(sessionManager.endTurn('failed'));
            session.sendSessionEvent({ type: 'ready' });
            continue;
          }
        }
        await switchModelAndEffortIfRequested(batch.mode.model, batch.mode.effort);
        const promptResult = await backend.sendPromptAndGetResult(acpSessionId, batch.message);
        await protocolWork;
        sendEnvelopes(sessionManager.endTurn(turnStatusForStopReason(promptResult.stopReason)));
        session.sendSessionEvent({ type: 'ready' });
        if (verbose) {
          logAcp('muted', `Outgoing prompt completion from ${opts.agentName}: stopReason=${promptResult.stopReason}`);
        }
      } catch (error) {
        await protocolWork;
        sendEnvelopes(sessionManager.endTurn('failed'));
        session.sendSessionEvent({ type: 'ready' });
        logAcp('error', `Prompt error from ${opts.agentName}: ${error instanceof Error ? error.message : String(error)}`);
        if (opts.agentName === 'grok') {
          const hardLimit = classifyGrokHardLimit(error);
          if (hardLimit) {
            try {
              await persistActiveGrokCredential();
            } catch (persistError) {
              logger.debug('[grok] Failed to persist named account credentials before rotation', persistError);
            }
            await reportProviderHardLimitOnce({
              sessionId: session.sessionId,
              ...hardLimit,
            });
          }
        }
        throw error;
      }
    }
  } finally {
    clearInterval(keepAliveInterval);
    reconnectionHandle?.cancel();

    try {
      permissionHandler.reset();
    } catch (error) {
      logger.debug(`[${opts.agentName}] Failed to reset permission handler:`, error);
    }

    backend.offMessage?.(onBackendMessage);
    if (opts.agentName === 'grok') {
      try {
        await persistActiveGrokCredential();
      } catch (error) {
        logger.debug('[grok] Failed to persist named account credentials during cleanup', error);
      }
    }
    await backend.dispose();

    try {
      happyServer.stop();
    } catch (error) {
      logger.debug(`[${opts.agentName}] Failed to stop Happy MCP server:`, error);
    }

    try {
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason: 'Session ended',
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (error) {
      logger.debug(`[${opts.agentName}] Session close failed:`, error);
    }
  }
}
