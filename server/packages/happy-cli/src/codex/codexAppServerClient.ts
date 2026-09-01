/**
 * Codex App Server Client — drives Codex via the v2 JSON-RPC protocol
 * (`codex app-server`), replacing the legacy MCP-based CodexMcpClient.
 *
 * Protocol: JSON-RPC 2.0 over stdio (newline-delimited JSON).
 * Reference: codex-rs/app-server/README.md in the openai/codex repo.
 *
 * WARNING: @openai/codex-sdk (v0.118.0) exists but only wraps `codex exec`
 * (non-interactive, fire-and-forget). It has NO support for `app-server`,
 * interactive approvals, or bidirectional JSON-RPC. We need app-server for
 * mobile approval routing (exec:request, patch:request, mcp:call), which is
 * why this client is hand-rolled. Re-evaluate if the SDK ever adds an
 * app-server wrapper or approval callbacks. See docs/plans/codex-app-server-migration.md.
 */

import { execSync, type ChildProcess } from 'node:child_process';
import { spawn as crossSpawn } from 'cross-spawn';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { logger } from '@/ui/logger';
import type {
    InitializeParams,
    NewConversationParams,
    NewConversationResponse,
    ResumeConversationParams,
    ResumeConversationResponse,
    ForkConversationParams,
    ForkConversationResponse,
    ReadConversationParams,
    ReadConversationResponse,
    RollbackConversationParams,
    RollbackConversationResponse,
    InjectItemsParams,
    InjectItemsResponse,
    ThreadGoalSetParams,
    ThreadGoalSetResponse,
    ThreadGoalClearParams,
    ThreadGoalClearResponse,
    Thread,
    InterruptConversationParams,
    ReviewDecision,
    EventMsg,
    JsonRpcRequest,
    JsonRpcResponse,
    ApprovalPolicy,
    SandboxMode,
    InputItem,
    SteerTurnParams,
    ReasoningEffort,
    McpServerElicitationRequestResponse,
    ModelListParams,
    ModelListResponse,
    ModelListEntry,
} from './codexAppServerTypes';
import type { SandboxConfig } from '@/persistence';
import { initializeSandbox, wrapForMcpTransport } from '@/sandbox/manager';
import packageJson from '../../package.json';
import { buildHappyHerdAgentCodexAppServerArgs } from './agentCodexPolicy';

const PROACTIVE_MULTI_AGENT_MODE_CONFIG =
    'features.multi_agent_v2.multi_agent_mode_hint_text="Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning sub-agents no longer applies. Use sub-agents when parallel work would materially improve speed or quality. This mode remains active until a later multi-agent mode developer message changes it."';

type PendingRequest = {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    method: string;
    epoch: number;
};

type PendingTurnCompletion = {
    resolve: (aborted: boolean) => void;
    turnId: string | null;
};

class CodexAppServerRpcError extends Error {
    constructor(
        readonly method: string,
        readonly code: number | null,
        readonly rpcMessage: string,
    ) {
        super(`${method}: ${rpcMessage}${code === null ? '' : ` (code=${code})`}`);
        this.name = 'CodexAppServerRpcError';
    }
}

function isNoActiveTurnToSteerError(error: unknown): error is CodexAppServerRpcError {
    return error instanceof CodexAppServerRpcError
        && error.method === 'turn/steer'
        && error.code === -32600
        && error.rpcMessage.trim().toLowerCase() === 'no active turn to steer';
}

export type CodexSteerTurnResult = 'steered' | 'turn-not-active';

type LegacyPatchChanges = Record<string, Record<string, unknown>>;

export type ApprovalHandler = (params: {
    type: 'exec' | 'patch' | 'mcp';
    callId: string;
    itemId?: string | null;
    threadId?: string | null;
    turnId?: string | null;
    approvalId?: string | null;
    command?: string[];
    cwd?: string;
    fileChanges?: Record<string, unknown>;
    reason?: string | null;
    toolName?: string;
    input?: unknown;
    serverName?: string;
    message?: string;
}) => Promise<ReviewDecision>;

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function buildTurnInput(prompt: string, extraInputItems: InputItem[] = []): InputItem[] {
    const input: InputItem[] = [];
    if (prompt.length > 0 || extraInputItems.length === 0) {
        input.push({ type: 'text', text: prompt });
    }
    input.push(...extraInputItems);
    return input;
}

// Codex item ids are per-thread counters, so items from collab subagent
// threads collide with the main thread's. Scoping with the thread id keeps
// them unique — but the SAME scoped id must be used both for the tool-call
// events and for the approval requests of an item: the app attaches a
// permission card to its tool call by exact id equality.
function formatScopedItemKey(threadId: string | null, itemId: string): string {
    return threadId ? `${threadId}:${itemId}` : itemId;
}

/**
 * Check that `codex app-server` is available.
 */
function parseCodexCliVersion(version: string): { major: number; minor: number; patch: number } | null {
    const match = version.match(/codex-cli\s+(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
        return null;
    }
    return { major, minor, patch };
}

function readCodexCliVersion(): { major: number; minor: number; patch: number } | null {
    try {
        const version = execSync('codex --version', { encoding: 'utf8', windowsHide: true }).trim();
        return parseCodexCliVersion(version);
    } catch {
        return null;
    }
}

function isAppServerAvailable(): boolean {
    const version = readCodexCliVersion();
    if (!version) {
        return false;
    }
    const { major, minor } = version;
    // app-server available in recent versions
    return major > 0 || minor >= 100;
}

function isGoalActionsAvailable(): boolean {
    const version = readCodexCliVersion();
    if (!version) {
        return false;
    }
    const { major, minor } = version;
    // thread/goal/set and thread/goal/clear are present in Codex 0.140+.
    return major > 0 || minor >= 140;
}

function normalizeRawFileChangeList(changes: unknown): LegacyPatchChanges | undefined {
    if (!Array.isArray(changes)) {
        return undefined;
    }

    const normalized: LegacyPatchChanges = {};
    for (const change of changes) {
        if (!change || typeof change !== 'object' || Array.isArray(change)) {
            continue;
        }

        const path = typeof change.path === 'string' ? change.path : null;
        if (!path) {
            continue;
        }

        const entry: Record<string, unknown> = {};
        const changeRecord = change as Record<string, unknown>;
        const kind = changeRecord.kind && typeof changeRecord.kind === 'object' && !Array.isArray(changeRecord.kind)
            ? changeRecord.kind as Record<string, unknown>
            : null;
        const type = typeof changeRecord.type === 'string'
            ? changeRecord.type
            : (typeof kind?.type === 'string' ? kind.type : null);
        const movePath = changeRecord.move_path ?? kind?.move_path ?? null;

        if (kind) {
            entry.kind = kind;
        } else if (type) {
            entry.kind = { type, move_path: movePath };
        }

        const diff = typeof changeRecord.diff === 'string'
            ? changeRecord.diff
            : (typeof changeRecord.unified_diff === 'string' ? changeRecord.unified_diff : null);
        if (diff !== null) {
            entry.diff = diff;
        }

        if (changeRecord.add && typeof changeRecord.add === 'object' && !Array.isArray(changeRecord.add)) {
            entry.add = changeRecord.add;
        }
        if (changeRecord.modify && typeof changeRecord.modify === 'object' && !Array.isArray(changeRecord.modify)) {
            entry.modify = changeRecord.modify;
        }
        if (changeRecord.delete && typeof changeRecord.delete === 'object' && !Array.isArray(changeRecord.delete)) {
            entry.delete = changeRecord.delete;
        }

        const content = typeof changeRecord.content === 'string' ? changeRecord.content : null;
        if (type === 'add' && content !== null) {
            entry.add = { content };
        }
        if (type === 'delete' && content !== null) {
            entry.delete = { content };
        }

        const oldContent = typeof changeRecord.oldContent === 'string'
            ? changeRecord.oldContent
            : (typeof changeRecord.old_content === 'string' ? changeRecord.old_content : null);
        const newContent = typeof changeRecord.newContent === 'string'
            ? changeRecord.newContent
            : (typeof changeRecord.new_content === 'string' ? changeRecord.new_content : null);
        if ((oldContent !== null || newContent !== null) && type !== 'add' && type !== 'delete') {
            entry.modify = {
                old_content: oldContent ?? '',
                new_content: newContent ?? '',
            };
        }

        normalized[path] = entry;
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export class CodexAppServerClient {
    private process: ChildProcess | null = null;
    private readline: ReadlineInterface | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private processEpoch = 0;
    private connected = false;
    private sandboxConfig?: SandboxConfig;
    private readonly agentPolicyEntrypoint?: string;
    private readonly requireSandbox: boolean;
    private sandboxCleanup: (() => Promise<void>) | null = null;
    public sandboxEnabled = false;

    // Session state
    private _threadId: string | null = null;
    private _turnId: string | null = null;
    private threadDefaults: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
        developerInstructions?: string;
    } | null = null;

    // Turn completion tracking for the currently active sendTurnAndWait call.
    // Provider turn identity keeps stale or child completions from releasing it.
    private pendingTurnCompletion: PendingTurnCompletion | null = null;

    // Tracks in-flight interruptTurn() RPCs so sendTurnAndWait can wait for them
    // before starting a new turn (prevents stale turn/interrupt from aborting the next turn).
    private pendingInterrupt: Promise<void> | null = null;
    private notificationProtocol: 'unknown' | 'legacy' | 'raw' = 'unknown';
    private completedTurnIds = new Set<string>();
    private rawFileChangesByItemId = new Map<string, LegacyPatchChanges>();
    private rawSubagentActivitySignaturesByItemId = new Map<string, Set<string>>();
    // Approval callIds currently awaiting an answer. One codex item can raise
    // several approval callbacks (approvalId exists to disambiguate them);
    // the bare scoped key is kept for the first so the app's permission ↔
    // tool-call join works, and only a concurrent second approval for the
    // same item gets a disambiguating suffix.
    private pendingApprovalCallIds = new Set<string>();

    // Handlers set by the consumer (runCodex.ts)
    private eventHandler: ((msg: EventMsg) => void) | null = null;
    private approvalHandler: ApprovalHandler | null = null;

    constructor(sandboxConfig?: SandboxConfig, options: {
        agentPolicyEntrypoint?: string;
        requireSandbox?: boolean;
    } = {}) {
        this.sandboxConfig = sandboxConfig;
        this.agentPolicyEntrypoint = options.agentPolicyEntrypoint;
        this.requireSandbox = options.requireSandbox ?? false;
    }

    get threadId(): string | null {
        return this._threadId;
    }

    get turnId(): string | null {
        return this._turnId;
    }

    get activeTurnId(): string | null {
        if (!this.pendingTurnCompletion) return null;
        return this.pendingTurnCompletion.turnId ?? this._turnId;
    }

    supportsGoalActions(): boolean {
        return isGoalActionsAvailable();
    }

    setEventHandler(handler: (msg: EventMsg) => void): void {
        this.eventHandler = handler;
    }

    setApprovalHandler(handler: ApprovalHandler): void {
        this.approvalHandler = handler;
    }

    private extractTurnId(params: any): string | null {
        const turnId = params?.turn?.id ?? params?.turnId ?? params?.turn_id ?? null;
        return typeof turnId === 'string' && turnId.length > 0 ? turnId : null;
    }

    private extractTurnStatus(params: any): string | null {
        const status = params?.turn?.status ?? params?.status ?? null;
        return typeof status === 'string' && status.length > 0 ? status : null;
    }

    private extractThreadId(params: any): string | null {
        const threadId = params?.threadId ?? params?.thread_id ?? params?.turn?.threadId ?? null;
        return typeof threadId === 'string' && threadId.length > 0 ? threadId : null;
    }

    private isRootThreadNotification(params: any): boolean {
        const threadId = this.extractThreadId(params);
        if (threadId) {
            return this._threadId !== null && threadId === this._threadId;
        }

        // Fail closed when a notification omits thread identity. A matching
        // root turn id is enough; an ambiguous event must never release the
        // main waiter merely because it lacked child provenance.
        const turnId = this.extractTurnId(params);
        const rootTurnId = this.pendingTurnCompletion?.turnId ?? this._turnId;
        return Boolean(turnId && rootTurnId && turnId === rootTurnId);
    }

    private childThreadScope(params: any): Record<string, string> {
        const threadId = this.extractThreadId(params);
        if (!threadId || !this._threadId || threadId === this._threadId) {
            return {};
        }
        return {
            agent_thread_id: threadId,
            agentThreadId: threadId,
        };
    }

    private shouldHandleRawNotification(method: string): boolean {
        const isAuthoritativeLifecycle = method === 'turn/started'
            || method === 'turn/completed'
            || method === 'thread/status/changed';
        const isRawNotification = method === 'thread/started'
            || method === 'thread/goal/updated'
            || method === 'thread/goal/cleared'
            || method === 'turn/started'
            || method === 'turn/completed'
            || method === 'thread/status/changed'
            || method === 'thread/tokenUsage/updated'
            || method.startsWith('item/');

        if (!isRawNotification) {
            return false;
        }

        // Raw lifecycle carries authoritative provider thread/turn identity.
        // Keep accepting it even if legacy codex/event notifications arrived
        // first; legacy task_complete is presentation data, not root truth.
        if (isAuthoritativeLifecycle) {
            this.notificationProtocol = 'raw';
            return true;
        }

        if (this.notificationProtocol === 'legacy') {
            return false;
        }

        if (this.notificationProtocol === 'unknown') {
            this.notificationProtocol = 'raw';
        }

        return true;
    }

    private emitRawTurnCompletion(
        turnId: string | null,
        status: string | null,
        error: unknown,
        source: string,
    ): void {
        if (this.shouldIgnoreTurnLifecycle(turnId, source)) {
            return;
        }

        const aborted = status === 'cancelled' || status === 'canceled' || status === 'aborted' || status === 'interrupted';
        this.resolvePendingTurn(aborted);
        if (!turnId || this._turnId === turnId) {
            this._turnId = null;
        }

        if (turnId) {
            this.completedTurnIds.add(turnId);
        }

        if (aborted) {
            this.eventHandler?.({
                type: 'turn_aborted',
                provider_terminal: true,
                ...(turnId ? { turn_id: turnId } : {}),
                ...(status ? { status } : {}),
                ...(error !== undefined && error !== null ? { error } : {}),
            });
            return;
        }

        this.eventHandler?.({
            type: 'task_complete',
            provider_terminal: true,
            ...(turnId ? { turn_id: turnId } : {}),
            ...(status ? { status } : {}),
            ...(error !== undefined && error !== null ? { error } : {}),
        });
    }

    private handleRawNotification(method: string, params: any): boolean {
        if (!this.shouldHandleRawNotification(method)) {
            return false;
        }

        if (method === 'turn/started') {
            if (!this.isRootThreadNotification(params)) {
                const childThreadId = this.extractThreadId(params);
                if (childThreadId) {
                    this.eventHandler?.({
                        type: 'subagent_activity',
                        kind: 'started',
                        agent_thread_id: childThreadId,
                        agentThreadId: childThreadId,
                    });
                }
                return true;
            }
            const turnId = this.extractTurnId(params);
            if (this.shouldIgnoreTurnLifecycle(turnId, method)) {
                return true;
            }
            if (turnId) {
                this._turnId = turnId;
            }
            this.markPendingTurnStarted(turnId);
            this.eventHandler?.({
                type: 'task_started',
                provider_lifecycle: true,
                ...(turnId ? { turn_id: turnId } : {}),
            });
            return true;
        }

        if (method === 'turn/completed') {
            if (!this.isRootThreadNotification(params)) {
                const childThreadId = this.extractThreadId(params);
                if (childThreadId) {
                    this.eventHandler?.({
                        type: 'subagent_terminal',
                        agent_thread_id: childThreadId,
                        agentThreadId: childThreadId,
                        status: this.extractTurnStatus(params) ?? 'unknown',
                        ...(params?.turn?.error !== undefined && params?.turn?.error !== null
                            ? { error: params.turn.error }
                            : {}),
                    });
                }
                return true;
            }
            this.emitRawTurnCompletion(
                this.extractTurnId(params),
                this.extractTurnStatus(params),
                params?.turn?.error ?? params?.error,
                method,
            );
            return true;
        }

        if (method === 'thread/status/changed') {
            if (!this.isRootThreadNotification(params)) {
                return true;
            }
            // Thread status is useful telemetry, but it is not terminal turn
            // evidence. A root thread may look idle while provider-owned child
            // work is still settling. Only root turn/completed releases the
            // local waiter.
            return true;
        }

        if (method === 'thread/goal/updated') {
            const threadId = typeof params?.threadId === 'string'
                ? params.threadId
                : (typeof params?.goal?.threadId === 'string' ? params.goal.threadId : undefined);
            const turnId = typeof params?.turnId === 'string' ? params.turnId : null;
            this.eventHandler?.({
                type: 'thread_goal_updated',
                ...(threadId ? { thread_id: threadId, threadId } : {}),
                ...(turnId ? { turn_id: turnId, turnId } : {}),
                goal: params?.goal,
            });
            return true;
        }

        if (method === 'thread/goal/cleared') {
            const threadId = typeof params?.threadId === 'string' ? params.threadId : undefined;
            this.eventHandler?.({
                type: 'thread_goal_cleared',
                ...(threadId ? { thread_id: threadId, threadId } : {}),
            });
            return true;
        }

        if (method === 'thread/tokenUsage/updated') {
            const tokenUsage = params?.tokenUsage;
            if (tokenUsage && typeof tokenUsage === 'object') {
                this.eventHandler?.({
                    type: 'token_count',
                    ...tokenUsage,
                });
            }
            return true;
        }

        const item = params?.item;
        if (!item || typeof item !== 'object') {
            return method.startsWith('item/');
        }

        if (method === 'item/completed' && item.type === 'reasoning') {
            const text = [
                ...(Array.isArray(item.summary) ? item.summary : []),
                ...(Array.isArray(item.content) ? item.content : []),
            ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n');
            if (text.length > 0) {
                this.eventHandler?.({
                    type: 'agent_reasoning',
                    text,
                    item_id: item.id,
                    ...this.childThreadScope(params),
                });
            }
            return true;
        }

        if (item.type === 'mcpToolCall') {
            const callId = typeof item.id === 'string'
                ? formatScopedItemKey(this.extractThreadId(params) ?? this._threadId, item.id)
                : '';
            const payload = {
                call_id: callId,
                callId,
                server: item.server,
                tool: item.tool,
                arguments: item.arguments,
                status: item.status,
                ...this.childThreadScope(params),
            };
            if (method === 'item/started') {
                this.eventHandler?.({ type: 'mcp_tool_begin', ...payload });
                return true;
            }
            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'mcp_tool_end',
                    ...payload,
                    result: item.result,
                    error: item.error,
                });
                this.eventHandler?.({
                    type: 'provider_output_item',
                    item,
                    ...this.childThreadScope(params),
                });
                return true;
            }
        }

        if (method === 'item/completed'
            && (item.type === 'imageGeneration' || item.type === 'dynamicToolCall')) {
            this.eventHandler?.({
                type: 'provider_output_item',
                item,
                ...this.childThreadScope(params),
            });
            return true;
        }

        if (method === 'item/started' && item.type === 'commandExecution') {
            const itemId = typeof item.id === 'string' ? item.id : '';
            // Scoped the same way as the approval request for this item, so
            // the app can attach the permission card to the tool call.
            const callId = itemId ? formatScopedItemKey(stringOrNull(params?.threadId) ?? this._threadId, itemId) : '';
            this.eventHandler?.({
                type: 'exec_command_begin',
                call_id: callId,
                callId,
                command: item.command,
                cwd: item.cwd,
                description: item.command,
                ...this.childThreadScope(params),
            });
            return true;
        }

        if (method === 'item/completed' && item.type === 'commandExecution') {
            const itemId = typeof item.id === 'string' ? item.id : '';
            const callId = itemId ? formatScopedItemKey(stringOrNull(params?.threadId) ?? this._threadId, itemId) : '';
            this.eventHandler?.({
                type: 'exec_command_end',
                call_id: callId,
                callId,
                output: item.aggregatedOutput ?? '',
                exit_code: item.exitCode ?? null,
                duration_ms: item.durationMs ?? null,
                status: item.status,
                cwd: item.cwd,
                command: item.command,
                ...this.childThreadScope(params),
            });
            return true;
        }

        if (item.type === 'fileChange') {
            const itemId = typeof item.id === 'string' ? item.id : '';
            const threadId = stringOrNull(params?.threadId) ?? this._threadId;
            const itemKey = itemId ? formatScopedItemKey(threadId, itemId) : '';
            const changes = normalizeRawFileChangeList(item.changes);

            if (itemId && changes) {
                this.rawFileChangesByItemId.set(itemKey, changes);
            }

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'patch_apply_begin',
                    call_id: itemKey,
                    callId: itemKey,
                    changes: changes ?? {},
                    ...this.childThreadScope(params),
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'patch_apply_end',
                    call_id: itemKey,
                    callId: itemKey,
                    status: item.status,
                    ...this.childThreadScope(params),
                });

                if (itemId && (item.status === 'completed' || item.status === 'failed' || item.status === 'declined')) {
                    this.rawFileChangesByItemId.delete(itemKey);
                }
                return true;
            }
        }

        if (item.type === 'collabAgentToolCall') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const payload = {
                call_id: callId,
                callId,
                tool: item.tool,
                status: item.status,
                sender_thread_id: item.senderThreadId,
                senderThreadId: item.senderThreadId,
                receiver_thread_ids: item.receiverThreadIds,
                receiverThreadIds: item.receiverThreadIds,
                prompt: item.prompt,
                model: item.model,
                reasoning_effort: item.reasoningEffort,
                reasoningEffort: item.reasoningEffort,
                agents_states: item.agentsStates,
                agentsStates: item.agentsStates,
            };

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'collab_agent_begin',
                    ...payload,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'collab_agent_end',
                    ...payload,
                });
                return true;
            }
        }

        if (item.type === 'subAgentActivity') {
            if (method === 'item/started' || method === 'item/completed') {
                const itemId = typeof item.id === 'string' ? item.id : '';
                const threadId = stringOrNull(params?.threadId);
                const itemKey = itemId ? formatScopedItemKey(threadId, itemId) : '';
                const signature = [
                    String(item.kind ?? ''),
                    String(item.agentThreadId ?? ''),
                    String(item.agentPath ?? ''),
                ].join('\0');
                const seenSignatures = itemKey
                    ? this.rawSubagentActivitySignaturesByItemId.get(itemKey)
                    : undefined;
                if (seenSignatures?.has(signature)) {
                    return true;
                }
                if (itemKey) {
                    const signatures = seenSignatures ?? new Set<string>();
                    signatures.add(signature);
                    this.rawSubagentActivitySignaturesByItemId.set(itemKey, signatures);
                }
                this.eventHandler?.({
                    type: 'subagent_activity',
                    item_id: item.id,
                    kind: item.kind,
                    agent_thread_id: item.agentThreadId,
                    agentThreadId: item.agentThreadId,
                    agent_path: item.agentPath,
                    agentPath: item.agentPath,
                });
            }
            return true;
        }

        if (method === 'item/completed' && item.type === 'agentMessage') {
            const text = typeof item.text === 'string' ? item.text : '';
            if (text.length > 0) {
                this.eventHandler?.({
                    type: 'agent_message',
                    message: text,
                    item_id: item.id,
                    phase: item.phase,
                    ...this.childThreadScope(params),
                });
            }

            // A final-answer item is presentation content, not terminal turn
            // evidence. Waiting for root turn/completed keeps late child
            // results attached to the provider-owned root lifecycle.
            return true;
        }

        return method.startsWith('item/');
    }

    // ─── Lifecycle ──────────────────────────────────────────────

    async connect(): Promise<void> {
        if (this.connected) return;

        if (!isAppServerAvailable()) {
            throw new Error(
                'Codex CLI is not installed\n\n' +
                'Please install Codex CLI using one of these methods:\n\n' +
                'Option 1 - npm (recommended):\n  npm install -g @openai/codex\n\n' +
                'Option 2 - Homebrew (macOS):\n  brew install --cask codex\n\n' +
                'Alternatively, use Claude Code:\n  happyherd claude',
            );
        }

        let command = 'codex';
        const appServerArgs = [
            ...(this.agentPolicyEntrypoint
                ? buildHappyHerdAgentCodexAppServerArgs(this.agentPolicyEntrypoint)
                : []),
            'app-server',
            '--listen',
            'stdio://',
            '-c',
            'project_doc_max_bytes=0',
            // Codex 0.146 derives explicit-request-only delegation from every
            // effort below ultra, including max. HappyHerd sessions use
            // proactive delegation independently of reasoning effort.
            '-c',
            PROACTIVE_MULTI_AGENT_MODE_CONFIG,
        ];
        let args = [...appServerArgs];
        this.sandboxEnabled = false;

        if (this.requireSandbox && !this.sandboxConfig?.enabled) {
            throw new Error('HappyHerd Agent Codex requires an enabled HappyHerd OS sandbox');
        }

        if (this.sandboxConfig?.enabled && process.platform !== 'win32') {
            try {
                this.sandboxCleanup = await initializeSandbox(this.sandboxConfig, process.cwd());
                const wrapped = await wrapForMcpTransport('codex', appServerArgs);
                command = wrapped.command;
                args = wrapped.args;
                this.sandboxEnabled = true;
                logger.info(`[CodexAppServer] Sandbox enabled`);
            } catch (error) {
                if (this.requireSandbox) {
                    throw new Error('HappyHerd Agent Codex sandbox initialization failed', { cause: error });
                }
                logger.warn('[CodexAppServer] Failed to initialize sandbox; continuing without.', error);
                this.sandboxCleanup = null;
            }
        }

        // Build env — same filtering as the old MCP client
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (typeof value === 'string') env[key] = value;
        }
        // Mute noisy rollout list logging
        const filter = 'codex_core::rollout::list=off';
        if (!env.RUST_LOG) {
            env.RUST_LOG = filter;
        } else if (!env.RUST_LOG.includes('codex_core::rollout::list=')) {
            env.RUST_LOG += `,${filter}`;
        }
        if (this.sandboxEnabled) {
            env.CODEX_SANDBOX = 'seatbelt';
        }

        logger.debug(`[CodexAppServer] Spawning: ${command} ${args.join(' ')}`);

        const epoch = ++this.processEpoch;
        // Use cross-spawn so npm-installed wrappers (codex.cmd / codex.ps1) resolve on Windows.
        // Native child_process.spawn fails with ENOENT for .cmd shims (issues #980, #1016).
        const proc = crossSpawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            windowsHide: true,
        });
        this.process = proc;

        proc.on('error', (err) => {
            logger.debug('[CodexAppServer] Process error:', err);
        });

        proc.on('exit', (code, signal) => {
            logger.debug(`[CodexAppServer] Process exited: code=${code} signal=${signal}`);
            // Ignore stale process exits from prior generations during reconnect.
            if (this.process !== proc || this.processEpoch !== epoch) {
                logger.debug('[CodexAppServer] Ignoring stale process exit');
                return;
            }
            this.connected = false;
            // Reject all pending requests
            for (const [id, req] of this.pending) {
                if (req.epoch !== epoch) continue;
                req.reject(new Error(`Codex process exited (code=${code}) while waiting for ${req.method}`));
                this.pending.delete(id);
            }
            // Resolve pending turn completion (treat as abort)
            this.resolvePendingTurn(true);
        });

        // Pipe stderr for debug logging
        proc.stderr?.on('data', (chunk: Buffer) => {
            if (this.process !== proc || this.processEpoch !== epoch) return;
            const text = chunk.toString().trim();
            if (text) logger.debug(`[CodexAppServer:stderr] ${text}`);
        });

        // Parse newline-delimited JSON from stdout
        this.readline = createInterface({ input: proc.stdout! });
        this.readline.on('line', (line) => {
            if (this.process !== proc || this.processEpoch !== epoch) return;
            this.handleLine(line, epoch);
        });

        // Perform initialize handshake
        const initParams: InitializeParams = {
            clientInfo: {
                name: 'happy-codex',
                title: 'Happy Codex Client',
                version: packageJson.version,
            },
            capabilities: {
                experimentalApi: true,
            },
        };
        await this.request('initialize', initParams);
        this.notify('initialized');
        this.connected = true;
        logger.debug('[CodexAppServer] Connected and initialized');
    }

    private async disconnectInternal(opts?: { preserveThreadState?: boolean }): Promise<void> {
        if (!this.connected && !this.process) return;

        const proc = this.process;
        const pid = proc?.pid;
        const epoch = this.processEpoch;
        logger.debug(`[CodexAppServer] Disconnecting; pid=${pid ?? 'none'}`);

        this.readline?.close();
        this.readline = null;

        try {
            proc?.stdin?.end();
            proc?.kill('SIGTERM');
        } catch { /* ignore */ }

        // Force kill after 2s (unref so timer doesn't block process exit)
        if (pid) {
            const killTimer = setTimeout(() => {
                try {
                    process.kill(pid, 0); // check alive
                    process.kill(pid, 'SIGKILL');
                } catch { /* already dead */ }
            }, 2000);
            killTimer.unref();
        }

        this.process = null;
        this.connected = false;
        this._turnId = null;
        this.notificationProtocol = 'unknown';
        this.completedTurnIds.clear();
        if (!opts?.preserveThreadState) {
            this._threadId = null;
            this.threadDefaults = null;
        }

        // Fail in-flight requests from this process generation.
        for (const [id, req] of this.pending) {
            if (req.epoch !== epoch) continue;
            req.reject(new Error(`Codex process disconnected while waiting for ${req.method}`));
            this.pending.delete(id);
        }

        // Resolve pending turn completion (treat as abort)
        this.resolvePendingTurn(true);

        if (this.sandboxCleanup) {
            try { await this.sandboxCleanup(); } catch { /* ignore */ }
            this.sandboxCleanup = null;
        }
        this.sandboxEnabled = false;

        logger.debug('[CodexAppServer] Disconnected');
    }

    async disconnect(): Promise<void> {
        await this.disconnectInternal();
    }

    private buildThreadConfig(mcpServers?: Record<string, unknown>): Record<string, unknown> | null {
        if (this.agentPolicyEntrypoint) {
            return {
                mcp_servers: mcpServers ?? {},
                web_search: 'disabled',
            };
        }
        return mcpServers ? { mcp_servers: mcpServers } : null;
    }

    private rememberThreadDefaults(opts: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
        developerInstructions?: string;
    }): void {
        this.threadDefaults = {
            model: opts.model,
            cwd: opts.cwd,
            approvalPolicy: opts.approvalPolicy,
            sandbox: opts.sandbox,
            mcpServers: opts.mcpServers,
            developerInstructions: opts.developerInstructions,
        };
    }

    // ─── Thread management ──────────────────────────────────────

    async startThread(opts: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
        developerInstructions?: string;
    }): Promise<{ threadId: string; model: string }> {
        const params: NewConversationParams = {
            model: opts.model ?? null,
            modelProvider: null,
            profile: null,
            cwd: opts.cwd ?? process.cwd(),
            approvalPolicy: opts.approvalPolicy ?? null,
            sandbox: opts.sandbox ?? null,
            config: this.buildThreadConfig(opts.mcpServers),
            baseInstructions: null,
            developerInstructions: opts.developerInstructions ?? null,
            compactPrompt: null,
            includeApplyPatchTool: this.agentPolicyEntrypoint ? false : null,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
        };

        const result = await this.request('thread/start', params) as NewConversationResponse;
        this._threadId = result.thread.id;
        this._turnId = null;
        this.rawSubagentActivitySignaturesByItemId.clear();
        this.rememberThreadDefaults(opts);
        logger.debug('[CodexAppServer] Thread started:', this._threadId);
        return { threadId: result.thread.id, model: result.model };
    }

    async resumeThread(opts?: {
        threadId?: string;
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
        developerInstructions?: string;
    }): Promise<{ threadId: string; model: string }> {
        const threadId = opts?.threadId ?? this._threadId;
        if (!threadId) {
            throw new Error('No thread available to resume.');
        }

        const defaults = this.threadDefaults ?? {};
        const params: ResumeConversationParams = {
            threadId,
            model: opts?.model ?? defaults.model ?? null,
            modelProvider: null,
            cwd: opts?.cwd ?? defaults.cwd ?? process.cwd(),
            approvalPolicy: opts?.approvalPolicy ?? defaults.approvalPolicy ?? null,
            sandbox: opts?.sandbox ?? defaults.sandbox ?? null,
            config: this.buildThreadConfig(opts?.mcpServers ?? defaults.mcpServers),
            baseInstructions: null,
            developerInstructions: opts?.developerInstructions ?? defaults.developerInstructions ?? null,
            persistExtendedHistory: true,
        };

        const result = await this.request('thread/resume', params) as ResumeConversationResponse;
        this._threadId = result.thread.id;
        this._turnId = null;
        this.rawSubagentActivitySignaturesByItemId.clear();
        this.rememberThreadDefaults({
            model: opts?.model ?? defaults.model,
            cwd: opts?.cwd ?? defaults.cwd,
            approvalPolicy: opts?.approvalPolicy ?? defaults.approvalPolicy,
            sandbox: opts?.sandbox ?? defaults.sandbox,
            mcpServers: opts?.mcpServers ?? defaults.mcpServers,
            developerInstructions: opts?.developerInstructions ?? defaults.developerInstructions,
        });
        logger.debug('[CodexAppServer] Thread resumed:', this._threadId);
        return { threadId: result.thread.id, model: result.model };
    }

    async forkThread(opts: {
        threadId: string;
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
        developerInstructions?: string;
    }): Promise<{ threadId: string; model: string; thread: Thread }> {
        const defaults = this.threadDefaults ?? {};
        const params: ForkConversationParams = {
            threadId: opts.threadId,
            model: opts.model ?? defaults.model ?? null,
            modelProvider: null,
            cwd: opts.cwd ?? defaults.cwd ?? process.cwd(),
            approvalPolicy: opts.approvalPolicy ?? defaults.approvalPolicy ?? null,
            sandbox: opts.sandbox ?? defaults.sandbox ?? null,
            config: this.buildThreadConfig(opts.mcpServers ?? defaults.mcpServers),
            baseInstructions: null,
            developerInstructions: opts.developerInstructions ?? defaults.developerInstructions ?? null,
            ephemeral: false,
            threadSource: null,
        };

        const result = await this.request('thread/fork', params) as ForkConversationResponse;
        this._threadId = result.thread.id;
        this._turnId = null;
        this.rememberThreadDefaults({
            model: opts.model ?? defaults.model,
            cwd: opts.cwd ?? defaults.cwd,
            approvalPolicy: opts.approvalPolicy ?? defaults.approvalPolicy,
            sandbox: opts.sandbox ?? defaults.sandbox,
            mcpServers: opts.mcpServers ?? defaults.mcpServers,
            developerInstructions: opts.developerInstructions ?? defaults.developerInstructions,
        });
        logger.debug('[CodexAppServer] Thread forked:', opts.threadId, '->', this._threadId);
        return { threadId: result.thread.id, model: result.model, thread: result.thread };
    }

    async readThread(opts: {
        threadId: string;
        includeTurns?: boolean;
    }): Promise<ReadConversationResponse> {
        const params: ReadConversationParams = {
            threadId: opts.threadId,
            includeTurns: opts.includeTurns ?? true,
        };
        return await this.request('thread/read', params) as ReadConversationResponse;
    }

    async rollbackThread(opts: {
        threadId: string;
        numTurns: number;
    }): Promise<RollbackConversationResponse> {
        const params: RollbackConversationParams = {
            threadId: opts.threadId,
            numTurns: opts.numTurns,
        };
        return await this.request('thread/rollback', params) as RollbackConversationResponse;
    }

    async injectItems(opts: {
        threadId: string;
        items: unknown[];
    }): Promise<InjectItemsResponse> {
        const params: InjectItemsParams = {
            threadId: opts.threadId,
            items: opts.items,
        };
        return await this.request('thread/inject_items', params) as InjectItemsResponse;
    }

    /**
     * Append a provider-native developer message immediately before a turn.
     * Codex ignores developerInstructions overrides when a thread is already
     * loaded, while injected developer items are model-visible on that turn.
     */
    async injectDeveloperInstructions(opts: {
        threadId: string;
        instructions: string;
    }): Promise<InjectItemsResponse> {
        return await this.injectItems({
            threadId: opts.threadId,
            items: [{
                type: 'message',
                role: 'developer',
                content: [{ type: 'input_text', text: opts.instructions }],
            }],
        });
    }

    async setGoal(opts: {
        threadId: string;
        objective: string;
        status?: ThreadGoalSetParams['status'];
        tokenBudget?: number | null;
    }): Promise<ThreadGoalSetResponse> {
        const params: ThreadGoalSetParams = {
            threadId: opts.threadId,
            objective: opts.objective,
            ...(opts.status !== undefined ? { status: opts.status } : {}),
            ...(opts.tokenBudget !== undefined ? { tokenBudget: opts.tokenBudget } : {}),
        };
        return await this.request('thread/goal/set', params) as ThreadGoalSetResponse;
    }

    async clearGoal(opts: {
        threadId: string;
    }): Promise<ThreadGoalClearResponse> {
        const params: ThreadGoalClearParams = {
            threadId: opts.threadId,
        };
        return await this.request('thread/goal/clear', params) as ThreadGoalClearResponse;
    }

    async reconnectAndResumeThread(): Promise<boolean> {
        const threadId = this._threadId;
        await this.disconnectInternal({ preserveThreadState: !!threadId });
        await this.connect();

        if (!threadId) {
            return false;
        }

        try {
            await this.resumeThread({ threadId });
            return true;
        } catch (error) {
            logger.warn('[CodexAppServer] Failed to resume thread after reconnect', error);
            this._threadId = null;
            this.threadDefaults = null;
            return false;
        }
    }

    // ─── Turn management ────────────────────────────────────────

    /** Default grace period after interrupt before forcing a restart (ms). */
    private static readonly ABORT_GRACE_MS = 3_000;

    private hasPendingTurnCompletion(): boolean {
        return this.pendingTurnCompletion !== null;
    }

    private resolvePendingTurn(aborted: boolean): void {
        if (!this.pendingTurnCompletion) return;
        this.pendingTurnCompletion.resolve(aborted);
        this.pendingTurnCompletion = null;
    }

    private markPendingTurnStarted(turnId?: string | null): void {
        if (!this.pendingTurnCompletion) return;
        if (turnId) {
            this.pendingTurnCompletion.turnId = turnId;
        }
    }

    private shouldIgnoreTurnLifecycle(turnId: string | null, source: string): boolean {
        if (!turnId) {
            return false;
        }
        if (this.completedTurnIds.has(turnId)) {
            logger.debug(`[CodexAppServer] Ignoring ${source} for retired turn ${turnId}`);
            return true;
        }

        const activeTurnId = this.pendingTurnCompletion?.turnId ?? this._turnId;
        if (activeTurnId && activeTurnId !== turnId) {
            logger.debug(
                `[CodexAppServer] Ignoring ${source} for turn ${turnId}; awaiting ${activeTurnId}`,
            );
            return true;
        }
        return false;
    }

    private reconcileInactiveSteer(
        pending: PendingTurnCompletion | null,
        expectedTurnId: string,
    ): void {
        const currentTurnId = pending?.turnId ?? this._turnId;
        if (!pending
            || this.pendingTurnCompletion !== pending
            || currentTurnId !== expectedTurnId
            || (this._turnId !== null && this._turnId !== expectedTurnId)) {
            return;
        }

        this.pendingTurnCompletion = null;
        if (this._turnId === expectedTurnId) {
            this._turnId = null;
        }

        if (!this.completedTurnIds.has(expectedTurnId)) {
            this.completedTurnIds.add(expectedTurnId);
            this.eventHandler?.({
                type: 'task_complete',
                provider_terminal: true,
                turn_id: expectedTurnId,
                status: 'completed',
                reason: 'stale_turn_reconciled',
                reconciled: true,
            });
        }

        // Let the steering caller queue the untouched input before the old turn
        // loop resumes and considers the session idle.
        queueMicrotask(() => pending.resolve(false));
    }

    private async waitForTurnCompletion(timeoutMs: number): Promise<boolean> {
        if (!this.hasPendingTurnCompletion()) {
            return true;
        }

        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (this.hasPendingTurnCompletion()) {
            if (Date.now() >= deadline) {
                return false;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return true;
    }

    /**
     * Request turn interruption and optionally force-restart the app-server if
     * the turn does not settle within a short grace period.
     */
    async abortTurnWithFallback(opts?: {
        gracePeriodMs?: number;
        forceRestartOnTimeout?: boolean;
    }): Promise<{ hadActiveTurn: boolean; aborted: boolean; forcedRestart: boolean; resumedThread: boolean }> {
        const hadActiveTurn = this.hasPendingTurnCompletion();

        // No active turn pending in this client call-site.
        if (!hadActiveTurn) {
            return { hadActiveTurn: false, aborted: false, forcedRestart: false, resumedThread: false };
        }

        const gracePeriodMs = opts?.gracePeriodMs ?? CodexAppServerClient.ABORT_GRACE_MS;
        // Best-effort interrupt request first, but do not block the fallback on
        // the interrupt RPC itself. Codex can stop emitting responses while a
        // tool/subagent/MCP call is wedged, and in that case the restart fallback
        // is the mechanism that actually makes Stop Execution reliable.
        void this.interruptTurn({ timeoutMs: Math.max(1, gracePeriodMs) });

        const settled = await this.waitForTurnCompletion(gracePeriodMs);
        if (settled) {
            return { hadActiveTurn: true, aborted: true, forcedRestart: false, resumedThread: false };
        }

        const shouldForceRestart = opts?.forceRestartOnTimeout ?? true;
        if (!shouldForceRestart) {
            return { hadActiveTurn: true, aborted: false, forcedRestart: false, resumedThread: false };
        }

        logger.warn(`[CodexAppServer] interrupt did not settle turn in ${gracePeriodMs}ms; force-restarting app-server`);
        const pendingTurnId = this.pendingTurnCompletion?.turnId ?? this._turnId;
        if (this.pendingTurnCompletion) {
            this.eventHandler?.({
                type: 'turn_aborted',
                reason: 'interrupted',
                ...(pendingTurnId ? { turn_id: pendingTurnId } : {}),
                forced_restart: true,
            });
        }
        const resumedThread = await this.reconnectAndResumeThread();
        return { hadActiveTurn: true, aborted: true, forcedRestart: true, resumedThread };
    }

    /**
     * Send a user turn and wait for it to complete.
     * Returns when task_complete or turn_aborted is received.
     */
    async sendTurn(prompt: string, opts?: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        effort?: ReasoningEffort;
        extraInputItems?: InputItem[];
    }): Promise<void> {
        if (!this._threadId) {
            throw new Error('No active thread. Call startThread first.');
        }

        const input = buildTurnInput(prompt, opts?.extraInputItems);

        // Build params — only include optional fields when set (server uses thread defaults otherwise)
        const params: Record<string, unknown> = {
            threadId: this._threadId,
            input,
        };
        if (opts?.cwd) params.cwd = opts.cwd;
        if (opts?.approvalPolicy) params.approvalPolicy = opts.approvalPolicy;
        if (opts?.model) params.model = opts.model;
        if (opts?.effort) params.effort = opts.effort;

        // Map sandbox mode to the camelCase policy format the server expects
        if (opts?.sandbox) {
            switch (opts.sandbox) {
                case 'workspace-write':
                    params.sandboxPolicy = { type: 'workspaceWrite' };
                    break;
                case 'danger-full-access':
                    params.sandboxPolicy = { type: 'dangerFullAccess' };
                    break;
                case 'read-only':
                    params.sandboxPolicy = { type: 'readOnly' };
                    break;
            }
        }

        // turn/start returns immediately; turn completes via events.
        // We don't await completion here — the caller's event handler
        // tracks task_complete / turn_aborted.
        const result = await this.request('turn/start', params) as { turn?: { id?: string | null } };
        const turnId = result?.turn?.id;
        if (typeof turnId === 'string' && turnId.length > 0) {
            this._turnId = turnId;
            if (this.pendingTurnCompletion) {
                this.pendingTurnCompletion.turnId = turnId;
            }
        }
    }

    /**
     * Add user input to the provider-owned active turn. This does not create a
     * local queue entry or a second turn; Codex remains responsible for the
     * turn lifecycle and its eventual terminal event.
     */
    async steerTurn(
        prompt: string,
        opts?: { extraInputItems?: InputItem[] },
    ): Promise<CodexSteerTurnResult> {
        if (!this._threadId) {
            throw new Error('No active thread. Call startThread first.');
        }
        const pending = this.pendingTurnCompletion;
        const expectedTurnId = pending?.turnId ?? (pending ? this._turnId : null);
        if (!expectedTurnId) {
            return 'turn-not-active';
        }

        const params: SteerTurnParams = {
            threadId: this._threadId,
            expectedTurnId,
            input: buildTurnInput(prompt, opts?.extraInputItems),
        };
        try {
            await this.request('turn/steer', params);
            return 'steered';
        } catch (error) {
            if (!isNoActiveTurnToSteerError(error)) {
                throw error;
            }
            this.reconcileInactiveSteer(pending, expectedTurnId);
            return 'turn-not-active';
        }
    }

    /**
     * Send a user turn and wait for authoritative provider terminal evidence.
     * There is deliberately no duration timeout: releasing the local queue while
     * Codex still owns the turn creates a false-idle split brain. Explicit user
     * interruption remains available through abortTurnWithFallback().
     */
    async sendTurnAndWait(prompt: string, opts?: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        effort?: ReasoningEffort;
        extraInputItems?: InputItem[];
        /** @deprecated Retained for call-site compatibility; no local turn timeout is applied. */
        turnTimeoutMs?: number;
    }): Promise<{ aborted: boolean }> {
        // Wait for any in-flight interruptTurn() to complete before starting a new
        // turn. Otherwise the stale turn/interrupt RPC can reach Codex after our
        // turn/start and abort the wrong turn.
        if (this.pendingInterrupt) {
            await this.pendingInterrupt;
            // Yield to the event loop so any stale turn_aborted/task_complete
            // notifications queued by the interrupted turn are processed now
            // (harmlessly, since pendingTurnCompletion is null at this point).
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const completion = new Promise<boolean>((resolve) => {
            this.pendingTurnCompletion = {
                resolve,
                turnId: null,
            };
        });

        try {
            await this.sendTurn(prompt, opts);
        } catch (err) {
            this.pendingTurnCompletion = null;
            throw err;
        }

        const aborted = await completion;
        return { aborted };
    }

    async interruptTurn(opts?: { timeoutMs?: number }): Promise<void> {
        if (!this._threadId) return;
        if (!this._turnId) {
            logger.debug('[CodexAppServer] interruptTurn: no active turnId, skipping');
            return;
        }
        const params: InterruptConversationParams = {
            threadId: this._threadId,
            turnId: this._turnId,
        };
        const doInterrupt = async () => {
            try {
                await this.request('turn/interrupt', params, opts?.timeoutMs);
            } catch (err) {
                // Ignore if no turn is active
                logger.debug('[CodexAppServer] interruptTurn error (may be expected):', err);
            } finally {
                this.pendingInterrupt = null;
            }
        };
        this.pendingInterrupt = doInterrupt();
        return this.pendingInterrupt;
    }

    // ─── State queries ──────────────────────────────────────────

    hasActiveThread(): boolean {
        return this._threadId !== null;
    }

    clearThreadState(): void {
        logger.debug(
            `[CodexAppServer] Clearing thread state: thread=${this._threadId ?? 'none'} turn=${this._turnId ?? 'none'}`,
        );
        this.resolvePendingTurn(true);
        this._threadId = null;
        this._turnId = null;
        this.threadDefaults = null;
        this.completedTurnIds.clear();
        this.rawFileChangesByItemId.clear();
        this.rawSubagentActivitySignaturesByItemId.clear();
    }

    /**
     * Read the model catalog exposed by the installed Codex app-server.
     * This is intentionally machine-side so Web/iOS never need a release when
     * Codex adds, hides, or changes a model's supported effort levels.
     */
    async listModels(opts?: { includeHidden?: boolean }): Promise<ModelListEntry[]> {
        const models: ModelListEntry[] = [];
        let cursor: string | null = null;

        do {
            const params: ModelListParams = {
                cursor,
                limit: 100,
                includeHidden: opts?.includeHidden ?? false,
            };
            const response = await this.request('model/list', params) as ModelListResponse;
            models.push(...response.data);
            cursor = response.nextCursor;
        } while (cursor);

        return models;
    }

    // ─── JSON-RPC transport ─────────────────────────────────────

    /** Default timeout for RPC requests (ms). */
    private static readonly REQUEST_TIMEOUT_MS = 30_000;

    private request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
        const timeout = timeoutMs ?? CodexAppServerClient.REQUEST_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            if (!this.process?.stdin?.writable) {
                reject(new Error(`Cannot send ${method}: stdin not writable`));
                return;
            }
            const id = this.nextId++;

            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out after ${timeout}ms (id=${id})`));
            }, timeout);

            this.pending.set(id, {
                resolve: (result) => { clearTimeout(timer); resolve(result); },
                reject: (err) => { clearTimeout(timer); reject(err); },
                method,
                epoch: this.processEpoch,
            });

            const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
            const line = JSON.stringify(msg) + '\n';
            logger.debug(`[CodexAppServer] → ${method} (id=${id})`);
            this.process.stdin.write(line);
        });
    }

    private notify(method: string, params?: unknown): void {
        if (!this.process?.stdin?.writable) return;
        const msg: JsonRpcRequest = { jsonrpc: '2.0', method, params };
        this.process.stdin.write(JSON.stringify(msg) + '\n');
        logger.debug(`[CodexAppServer] → ${method} (notification)`);
    }

    private respond(id: number, result: unknown): void {
        if (!this.process?.stdin?.writable) return;
        const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result };
        this.process.stdin.write(JSON.stringify(msg) + '\n');
        logger.debug(`[CodexAppServer] → response (id=${id})`);
    }

    private handleLine(line: string, sourceEpoch: number = this.processEpoch): void {
        if (sourceEpoch !== this.processEpoch) {
            return;
        }
        if (!line.trim()) return;

        let msg: any;
        try {
            msg = JSON.parse(line);
        } catch {
            logger.debug('[CodexAppServer] Non-JSON line:', line.substring(0, 200));
            return;
        }

        // Response to our request
        if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
            const pending = this.pending.get(msg.id);
            if (pending) {
                if (pending.epoch !== sourceEpoch) {
                    logger.debug(`[CodexAppServer] Ignoring response from stale epoch for id=${msg.id}`);
                    return;
                }
                this.pending.delete(msg.id);
                if (msg.error) {
                    const rpcMessage = typeof msg.error?.message === 'string'
                        ? msg.error.message
                        : 'Unknown error';
                    const rpcCode = typeof msg.error?.code === 'number'
                        ? msg.error.code
                        : null;
                    pending.reject(new CodexAppServerRpcError(pending.method, rpcCode, rpcMessage));
                } else {
                    pending.resolve(msg.result);
                }
            }
            return;
        }

        // Server → client request (approvals)
        if (msg.id != null && msg.method) {
            this.handleServerRequest(msg.id, msg.method, msg.params).catch((err) => {
                logger.debug('[CodexAppServer] Error handling server request:', err);
            });
            return;
        }

        // Notification (no id)
        if (msg.method) {
            this.handleNotification(msg.method, msg.params);
            return;
        }

        logger.debug('[CodexAppServer] Unhandled message:', JSON.stringify(msg).substring(0, 300));
    }

    /**
     * Map our internal ReviewDecision to the wire format the server expects.
     * Server uses: accept, acceptForSession, decline, cancel
     * Our handler uses: approved, approved_for_session, denied, abort
     */
    /**
     * Map our internal ReviewDecision to the wire format codex expects.
     * v2 methods (item/*) use: accept/acceptForSession/decline/cancel
     * Legacy methods (execCommandApproval/applyPatchApproval) use: approved/approved_for_session/denied/abort
     */
    private mapDecisionToWire(decision: ReviewDecision, legacy: boolean): string | Record<string, unknown> {
        if (typeof decision === 'string') {
            if (legacy) {
                // Legacy wire format — pass through as-is (approved/denied/abort)
                return decision;
            }
            // v2 wire format
            switch (decision) {
                case 'approved': return 'accept';
                case 'approved_for_session': return 'acceptForSession';
                case 'denied': return 'decline';
                case 'abort': return 'cancel';
                default: return 'decline';
            }
        }
        // Object variant: approved_execpolicy_amendment → pass through as-is
        if ('approved_execpolicy_amendment' in decision) {
            return decision;
        }
        return legacy ? 'denied' : 'decline';
    }

    private parseToolNameFromElicitationMessage(message: unknown): string | null {
        if (typeof message !== 'string') {
            return null;
        }
        const match = message.match(/tool "([^"]+)"/i);
        return match?.[1] ?? null;
    }

    private mapDecisionToMcpElicitationResponse(
        decision: ReviewDecision,
        params: any,
    ): McpServerElicitationRequestResponse {
        if (typeof decision === 'string') {
            switch (decision) {
                case 'approved':
                case 'approved_for_session':
                    return {
                        action: 'accept',
                        content: params?.mode === 'form' ? {} : null,
                        _meta: null,
                    };
                case 'abort':
                    return {
                        action: 'cancel',
                        content: null,
                        _meta: null,
                    };
                case 'denied':
                default:
                    return {
                        action: 'decline',
                        content: null,
                        _meta: null,
                    };
            }
        }

        return {
            action: 'decline',
            content: null,
            _meta: null,
        };
    }

    private async handleServerRequest(id: number, method: string, params: any): Promise<void> {
        if (method === 'mcpServer/elicitation/request') {
            const threadId = stringOrNull(params?.threadId) ?? this._threadId;
            const turnId = stringOrNull(params?.turnId);
            const serverName = stringOrNull(params?.serverName) ?? 'mcp';
            const toolName = this.parseToolNameFromElicitationMessage(params?.message) ?? serverName;
            const itemId = `${serverName}:${id}`;
            const decision = await this.handleApproval({
                type: 'mcp',
                callId: formatScopedItemKey(threadId, itemId),
                itemId,
                threadId,
                turnId,
                approvalId: String(id),
                toolName,
                input: params?._meta?.tool_params ?? {},
                serverName,
                message: params?.message,
            });
            this.respond(id, this.mapDecisionToMcpElicitationResponse(decision, params));
            return;
        }

        // Command execution approval
        if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
            const legacy = method === 'execCommandApproval';
            const threadId = stringOrNull(params?.threadId) ?? stringOrNull(params?.conversationId) ?? this._threadId;
            const turnId = stringOrNull(params?.turnId);
            const itemId = stringOrNull(params?.itemId) ?? stringOrNull(params?.callId) ?? String(id);
            const approvalId = stringOrNull(params?.approvalId);
            // Legacy events pass through with raw call ids, so legacy
            // approvals must stay raw too; v2 uses the scoped item key that
            // exec_command_begin emitted for this item, so the app joins
            // permission ↔ tool call by exact id equality. Only a concurrent
            // second approval for the same item gets an approvalId suffix.
            const callId = legacy
                ? itemId
                : this.resolveApprovalCallId(formatScopedItemKey(threadId, itemId), approvalId ?? String(id));
            this.pendingApprovalCallIds.add(callId);
            try {
                const decision = await this.handleApproval({
                    type: 'exec',
                    callId,
                    itemId,
                    threadId,
                    turnId,
                    approvalId,
                    command: Array.isArray(params.command)
                        ? params.command
                        : params.command != null ? [params.command] : [],
                    cwd: params.cwd,
                    reason: params.reason,
                });
                this.respond(id, { decision: this.mapDecisionToWire(decision, legacy) });
            } finally {
                this.pendingApprovalCallIds.delete(callId);
            }
            return;
        }

        // File change / patch approval
        if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
            const legacy = method === 'applyPatchApproval';
            const threadId = stringOrNull(params?.threadId) ?? stringOrNull(params?.conversationId) ?? this._threadId;
            const turnId = stringOrNull(params?.turnId);
            const itemId = stringOrNull(params?.itemId) ?? stringOrNull(params?.callId) ?? String(id);
            const itemKey = formatScopedItemKey(threadId, itemId);
            const callId = legacy ? itemId : this.resolveApprovalCallId(itemKey, String(id));
            this.pendingApprovalCallIds.add(callId);
            try {
                const decision = await this.handleApproval({
                    type: 'patch',
                    callId,
                    itemId,
                    threadId,
                    turnId,
                    fileChanges: params.fileChanges ?? (typeof itemId === 'string'
                        ? this.rawFileChangesByItemId.get(itemKey) ?? this.rawFileChangesByItemId.get(itemId)
                        : undefined),
                    reason: params.reason,
                });
                this.respond(id, { decision: this.mapDecisionToWire(decision, legacy) });
            } finally {
                this.pendingApprovalCallIds.delete(callId);
            }
            return;
        }

        // Unknown server request — respond so server doesn't hang
        logger.debug(`[CodexAppServer] Unknown server request: ${method}`);
        this.respond(id, {});
    }

    // The bare scoped key keeps the app's permission ↔ tool-call join for the
    // common single-approval case; a SECOND approval arriving while the first
    // is still pending gets a disambiguating suffix instead of silently
    // overwriting the first one's pending entry (which would orphan its
    // promise and hang the codex request forever).
    private resolveApprovalCallId(baseCallId: string, disambiguator: string): string {
        return this.pendingApprovalCallIds.has(baseCallId)
            ? `${baseCallId}:${disambiguator}`
            : baseCallId;
    }

    private async handleApproval(params: Parameters<ApprovalHandler>[0]): Promise<ReviewDecision> {
        if (this.approvalHandler) {
            try {
                return await this.approvalHandler(params);
            } catch (err) {
                logger.debug('[CodexAppServer] Approval handler error:', err);
                return 'denied';
            }
        }
        return 'denied'; // default: deny if no handler
    }

    private handleNotification(method: string, params: any): void {
        if (method === 'account/rateLimits/updated') {
            this.eventHandler?.({
                type: 'account_rate_limits_updated',
                rateLimits: params,
            });
            return;
        }
        // codex/event notifications: either `codex/event` or `codex/event/<type>`
        if (method === 'codex/event' || method.startsWith('codex/event/')) {
            if (this.notificationProtocol === 'unknown') {
                this.notificationProtocol = 'legacy';
            }
            const msg = params?.msg;
            if (msg) {
                // Legacy task lifecycle is forwarded for compatibility and
                // diagnostics, but never resolves the root waiter. Modern
                // app-server can emit task_complete while provider-native
                // children are still active; raw root turn/completed is the
                // sole authority that releases the queue.
                const isLegacyLifecycle = msg.type === 'task_started'
                    || msg.type === 'task_complete'
                    || msg.type === 'turn_aborted';
                this.eventHandler?.(isLegacyLifecycle
                    ? { ...msg, provider_lifecycle: false, provider_terminal: false }
                    : msg);
            }
            return;
        }

        if (this.handleRawNotification(method, params)) {
            logger.debug(`[CodexAppServer] Raw notification: ${method}`);
            return;
        }

        // v2 lifecycle notifications
        if (method === 'thread/started' || method === 'turn/started' ||
            method === 'turn/completed' || method === 'thread/status/changed') {
            logger.debug(`[CodexAppServer] Lifecycle notification: ${method}`);
            // Mark the turn as started so the completion guard lets it through.
            if (method === 'turn/started') {
                const turnId = this.extractTurnId(params);
                if (turnId) {
                    this._turnId = turnId;
                }
                this.markPendingTurnStarted(turnId);
            }
            // turn/completed is a fallback signal — for mid-inference interrupts,
            // Codex may only signal completion here (not via codex/event turn_aborted).
            // emitRawTurnCompletion deduplicates via completedTurnIds if legacy already handled it.
            if (method === 'turn/completed') {
                this.emitRawTurnCompletion(
                    this.extractTurnId(params),
                    this.extractTurnStatus(params),
                    params?.turn?.error ?? params?.error,
                    method,
                );
            }
            return;
        }

        // MCP server lifecycle: log payload so we can diagnose failed launches
        // (e.g. happy-mcp bridge failing on Windows due to shebang execution).
        if (method === 'mcpServer/startupStatus/updated') {
            logger.debug(`[CodexAppServer] mcpServer startup status:`, params);
            return;
        }

        logger.debug(`[CodexAppServer] Notification: ${method}`);
    }
}
