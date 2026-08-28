import { createHash, randomUUID } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import type { ReasoningOutput } from './reasoningProcessor';
import type { DiffToolCall, DiffToolResult } from './diffProcessor';
import {
    createEnvelope,
    stripLeadingTaskNotificationWrappers,
    type CreateEnvelopeOptions,
    type SessionEnvelope,
    type SessionUsage,
} from '@slopus/happy-wire';
import type { Thread, ThreadItem, ThreadTurn } from '../codexAppServerTypes';
import { stripHappySystemBlocks } from '../codexPrompt';

export type CodexTurnState = {
    currentTurnId: string | null;
    lastTurnId?: string | null;
    startedSubagents?: Set<string>;
    activeSubagents?: Set<string>;
    subagentTurnIds?: Map<string, string>;
    subagentStops?: Map<string, { status: SubagentStopStatus; authoritative: boolean }>;
    providerSubagentToSessionSubagent?: Map<string, string>;
    subagentTitles?: Map<string, string>;
    collabReceiverThreadIdsByCall?: Map<string, string[]>;
    collabTurnIdsByCall?: Map<string, string>;
    collabToolByCall?: Map<string, string>;
};

type CodexMapperResult = {
    currentTurnId: string | null;
    lastTurnId: string | null;
    startedSubagents: Set<string>;
    activeSubagents: Set<string>;
    subagentTurnIds: Map<string, string>;
    subagentStops: Map<string, { status: SubagentStopStatus; authoritative: boolean }>;
    providerSubagentToSessionSubagent: Map<string, string>;
    subagentTitles: Map<string, string>;
    collabReceiverThreadIdsByCall: Map<string, string[]>;
    collabTurnIdsByCall: Map<string, string>;
    collabToolByCall: Map<string, string>;
    envelopes: SessionEnvelope[];
};

type LegacyToolLikeMessage = {
    type: 'tool-call' | 'tool-call-result';
    callId: string;
    name?: string;
    input?: unknown;
    output?: {
        content?: string;
        status?: 'completed' | 'canceled';
    };
};

type TurnEndStatus = 'completed' | 'failed' | 'cancelled';
type SubagentStopStatus = 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';

function getStartedSubagents(state: CodexTurnState): Set<string> {
    return state.startedSubagents ?? new Set<string>();
}

function getActiveSubagents(state: CodexTurnState): Set<string> {
    return state.activeSubagents ?? new Set<string>();
}

function getSubagentTurnIds(state: CodexTurnState): Map<string, string> {
    return state.subagentTurnIds ?? new Map<string, string>();
}

function getSubagentStops(
    state: CodexTurnState,
): Map<string, { status: SubagentStopStatus; authoritative: boolean }> {
    return state.subagentStops ?? new Map<string, { status: SubagentStopStatus; authoritative: boolean }>();
}

function getProviderSubagentToSessionSubagent(state: CodexTurnState): Map<string, string> {
    return state.providerSubagentToSessionSubagent ?? new Map<string, string>();
}

function getSubagentTitles(state: CodexTurnState): Map<string, string> {
    return state.subagentTitles ?? new Map<string, string>();
}

function getCollabReceiverThreadIdsByCall(state: CodexTurnState): Map<string, string[]> {
    return state.collabReceiverThreadIdsByCall ?? new Map<string, string[]>();
}

function getCollabTurnIdsByCall(state: CodexTurnState): Map<string, string> {
    return state.collabTurnIdsByCall ?? new Map<string, string>();
}

function getCollabToolByCall(state: CodexTurnState): Map<string, string> {
    return state.collabToolByCall ?? new Map<string, string>();
}

function deterministicSessionSubagentId(providerSubagent: string): string {
    const digest = createHash('sha256')
        .update(`codex-subagent:${providerSubagent}`)
        .digest('hex');
    return `c${digest.slice(0, 23)}`;
}

function ensureSessionSubagent(
    providerSubagent: string,
    providerSubagentToSessionSubagent: Map<string, string>,
): string {
    const existing = providerSubagentToSessionSubagent.get(providerSubagent);
    if (existing) {
        return existing;
    }

    const created = deterministicSessionSubagentId(providerSubagent);
    providerSubagentToSessionSubagent.set(providerSubagent, created);
    return created;
}

function maybeEmitSubagentStart(
    subagent: string | undefined,
    opts: CreateEnvelopeOptions,
    startedSubagents: Set<string>,
    activeSubagents: Set<string>,
    subagentTurnIds: Map<string, string>,
    subagentTitles: Map<string, string>,
    envelopes: SessionEnvelope[],
): void {
    if (!subagent) {
        return;
    }

    const owningTurn = subagentTurnIds.get(subagent) ?? opts.turn;
    if (!owningTurn || startedSubagents.has(subagent)) {
        return;
    }
    subagentTurnIds.set(subagent, owningTurn);

    const title = subagentTitles.get(subagent);
    envelopes.push(createEnvelope('agent', {
        t: 'start',
        ...(title ? { title } : {}),
    }, {
        ...opts,
        id: `${owningTurn}:${subagent}:start`,
        turn: owningTurn,
        subagent,
    }));
    startedSubagents.add(subagent);
    activeSubagents.add(subagent);
}

function maybeEmitSubagentStop(
    subagent: string | undefined,
    opts: CreateEnvelopeOptions,
    activeSubagents: Set<string>,
    subagentTurnIds: Map<string, string>,
    subagentStops: Map<string, { status: SubagentStopStatus; authoritative: boolean }>,
    envelopes: SessionEnvelope[],
    status: SubagentStopStatus,
    detail?: string,
    authoritative = true,
): void {
    if (!subagent) {
        return;
    }

    const previous = subagentStops.get(subagent);
    if (previous?.authoritative && !authoritative) {
        return;
    }
    if (!activeSubagents.has(subagent)) {
        if (!previous || !authoritative) {
            return;
        }
        if (previous.authoritative && previous.status === status) {
            return;
        }
    }
    const owningTurn = subagentTurnIds.get(subagent) ?? opts.turn;
    if (!owningTurn) {
        return;
    }
    subagentTurnIds.set(subagent, owningTurn);

    envelopes.push(createEnvelope('agent', {
        t: 'stop',
        status,
        authoritative,
        ...(detail ? { detail } : {}),
    }, {
        ...opts,
        id: `${owningTurn}:${subagent}:stop:${authoritative ? 'provider' : 'provisional'}:${status}`,
        turn: owningTurn,
        subagent,
    }));
    activeSubagents.delete(subagent);
    subagentStops.set(subagent, { status, authoritative });
}

function emitSubagentStops(
    opts: CreateEnvelopeOptions,
    activeSubagents: Set<string>,
    subagentTurnIds: Map<string, string>,
    subagentStops: Map<string, { status: SubagentStopStatus; authoritative: boolean }>,
    status: SubagentStopStatus,
    detail?: string,
): SessionEnvelope[] {
    const envelopes: SessionEnvelope[] = [];
    for (const subagent of [...activeSubagents]) {
        maybeEmitSubagentStop(
            subagent,
            opts,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            envelopes,
            status,
            detail,
            false,
        );
    }
    return envelopes;
}

function buildEnvelopeOptions(currentTurnId: string | null, subagent?: string): CreateEnvelopeOptions {
    return {
        ...(currentTurnId ? { turn: currentTurnId } : {}),
        ...(subagent ? { subagent } : {}),
    };
}

function pickTokenCount(message: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = message[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            return Math.trunc(value);
        }
    }
    return undefined;
}

function pickTokenUsageSource(message: Record<string, unknown>): Record<string, unknown> {
    if (message.last && typeof message.last === 'object' && !Array.isArray(message.last)) {
        return message.last as Record<string, unknown>;
    }
    return message.total && typeof message.total === 'object' && !Array.isArray(message.total)
        ? message.total as Record<string, unknown>
        : message;
}

function pickTokenUsage(message: Record<string, unknown>): SessionUsage | undefined {
    const source = pickTokenUsageSource(message);
    const input = pickTokenCount(source, ['input_tokens', 'inputTokens', 'input', 'prompt_tokens', 'promptTokens']);
    const output = pickTokenCount(source, ['output_tokens', 'outputTokens', 'output', 'completion_tokens', 'completionTokens']);
    const cacheCreation = pickTokenCount(source, [
        'cache_creation_input_tokens',
        'cacheCreationInputTokens',
        'cacheCreation',
        'cache_write_input_tokens',
        'cacheWriteInputTokens',
    ]);
    const cacheRead = pickTokenCount(source, [
        'cache_read_input_tokens',
        'cacheReadInputTokens',
        'cacheRead',
        'cached_input_tokens',
        'cachedInputTokens',
    ]);
    const total = pickTokenCount(source, ['total_tokens', 'totalTokens', 'tokensUsed', 'usedTokens']);
    const contextWindow = pickTokenCount(message, [
        'context_window',
        'contextWindow',
        'model_context_window',
        'modelContextWindow',
    ]);

    if (
        input === undefined
        && output === undefined
        && cacheCreation === undefined
        && cacheRead === undefined
        && total === undefined
    ) {
        return undefined;
    }

    const outputTokens = output ?? 0;
    const cacheCreationTokens = cacheCreation ?? 0;
    const cacheReadTokens = cacheRead ?? 0;
    const inputTokensIncludeCache = input !== undefined
        && total !== undefined
        && total === input + outputTokens;
    const fallbackInputTokens = input
        ?? Math.max(0, (total ?? 0) - outputTokens - cacheCreationTokens - cacheReadTokens);
    const inputTokens = inputTokensIncludeCache && input !== undefined
        ? Math.max(0, input - cacheCreationTokens - cacheReadTokens)
        : fallbackInputTokens;
    const serviceTier = typeof message.service_tier === 'string'
        ? message.service_tier
        : (typeof message.serviceTier === 'string' ? message.serviceTier : undefined);

    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ...(cacheCreation !== undefined ? { cache_creation_input_tokens: cacheCreationTokens } : {}),
        ...(cacheRead !== undefined ? { cache_read_input_tokens: cacheReadTokens } : {}),
        ...(contextWindow !== undefined ? { context_window: contextWindow } : {}),
        ...(serviceTier ? { service_tier: serviceTier } : {}),
    };
}

function pickProviderSubagent(message: Record<string, unknown>): string | undefined {
    const candidates = [
        message.subagent,
        message.parent_call_id,
        message.parentCallId,
        message.agent_thread_id,
        message.agentThreadId,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate;
        }
    }
    return undefined;
}

function resolveSessionSubagent(
    message: Record<string, unknown>,
    providerSubagentToSessionSubagent: Map<string, string>,
): string | undefined {
    const providerSubagent = pickProviderSubagent(message);
    if (!providerSubagent) {
        return undefined;
    }

    return ensureSessionSubagent(providerSubagent, providerSubagentToSessionSubagent);
}

function deterministicCollabCallId(message: Record<string, unknown>): string {
    const identity = [
        pickString(message.tool) ?? '',
        pickString(message.sender_thread_id ?? message.senderThreadId) ?? '',
        [...pickStringArray(message.receiver_thread_ids ?? message.receiverThreadIds)].sort().join(','),
        pickString(message.prompt) ?? '',
        pickString(message.model) ?? '',
    ].join('\0');
    return `codex-collab-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function pickCallId(
    message: Record<string, unknown>,
    collabToolByCall?: Map<string, string>,
    isEnd = false,
): string {
    const callId = message.call_id ?? message.callId;
    if (typeof callId === 'string' && callId.length > 0) {
        return callId;
    }
    if (collabToolByCall && isEnd) {
        const deterministic = deterministicCollabCallId(message);
        if (collabToolByCall.has(deterministic)) {
            return deterministic;
        }
        const tool = pickString(message.tool);
        const candidates = [...collabToolByCall.entries()]
            .filter(([, rememberedTool]) => rememberedTool === tool)
            .map(([rememberedCall]) => rememberedCall);
        if (candidates.length === 1) {
            return candidates[0];
        }
    }
    if (pickString(message.tool)) {
        return deterministicCollabCallId(message);
    }
    return randomUUID();
}

function pickString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;
}

function pickStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function shortText(value: string, max = 80): string {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function collabToolTitle(tool: string | undefined, prompt: string | undefined): string {
    if (prompt) {
        return shortText(prompt);
    }

    switch (tool) {
        case 'spawnAgent':
            return 'Spawn Codex subagent';
        case 'sendInput':
            return 'Send input to Codex subagent';
        case 'resumeAgent':
            return 'Resume Codex subagent';
        case 'wait':
            return 'Wait for Codex subagent';
        case 'closeAgent':
            return 'Close Codex subagent';
        default:
            return 'Codex subagent';
    }
}

function collabToolDescription(tool: string | undefined, prompt: string | undefined): string {
    const title = collabToolTitle(tool, prompt);
    if (!prompt) {
        return title;
    }
    switch (tool) {
        case 'spawnAgent':
            return `Spawn Codex subagent: ${shortText(prompt, 120)}`;
        case 'sendInput':
            return `Send input to Codex subagent: ${shortText(prompt, 120)}`;
        default:
            return title;
    }
}

function pickCollabReceiverThreadIds(message: Record<string, unknown>): string[] {
    return pickStringArray(message.receiver_thread_ids ?? message.receiverThreadIds);
}

function pickCollabAgentStateThreadIds(message: Record<string, unknown>): string[] {
    const raw = message.agents_states ?? message.agentsStates;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }
    return Object.keys(raw).filter((key) => key.length > 0);
}

function resolveCollabProviderIds(
    call: string,
    message: Record<string, unknown>,
    collabReceiverThreadIdsByCall: Map<string, string[]>,
): string[] {
    const receiverThreadIds = pickCollabReceiverThreadIds(message);
    if (receiverThreadIds.length > 0) {
        collabReceiverThreadIdsByCall.set(call, receiverThreadIds);
        return receiverThreadIds;
    }

    const remembered = collabReceiverThreadIdsByCall.get(call);
    if (remembered && remembered.length > 0) {
        return remembered;
    }

    const stateThreadIds = pickCollabAgentStateThreadIds(message);
    if (stateThreadIds.length > 0) {
        collabReceiverThreadIdsByCall.set(call, stateThreadIds);
        return stateThreadIds;
    }

    // A collab call id identifies the provider tool invocation, not the child
    // thread. Codex may omit receiver ids from the begin event and supply them
    // only on the matching end/activity event. Creating a child from `call`
    // would leave a duplicate provisional sidechain beside the real child.
    return [];
}

function resolveCollabTool(
    call: string,
    message: Record<string, unknown>,
    collabToolByCall: Map<string, string>,
): string | undefined {
    const tool = pickString(message.tool);
    if (tool) {
        collabToolByCall.set(call, tool);
        return tool;
    }
    return collabToolByCall.get(call);
}

function isCollabCallInProgress(message: Record<string, unknown>): boolean {
    const status = pickString(message.status);
    return status === 'inProgress';
}

function collabAgentStates(
    message: Record<string, unknown>,
    sessionSubagentsByProviderId: Record<string, string>,
): Array<{ sessionSubagent: string; status?: string; message?: string | null }> {
    const raw = message.agents_states ?? message.agentsStates;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }

    const states: Array<{ sessionSubagent: string; status?: string; message?: string | null }> = [];
    for (const [providerId, state] of Object.entries(raw as Record<string, unknown>)) {
        const sessionSubagent = sessionSubagentsByProviderId[providerId];
        if (!sessionSubagent || !state || typeof state !== 'object' || Array.isArray(state)) {
            continue;
        }
        const record = state as Record<string, unknown>;
        states.push({
            sessionSubagent,
            ...(typeof record.status === 'string' ? { status: record.status } : {}),
            ...(typeof record.message === 'string' || record.message === null ? { message: record.message } : {}),
        });
    }
    return states;
}

function emitCollabAgentStateMessages(
    envelopes: SessionEnvelope[],
    message: Record<string, unknown>,
    call: string,
    sessionSubagentsByProviderId: Record<string, string>,
    opts: CreateEnvelopeOptions,
    activeSubagents: Set<string>,
    subagentTurnIds: Map<string, string>,
    subagentStops: Map<string, { status: SubagentStopStatus; authoritative: boolean }>,
): void {
    const raw = message.agents_states ?? message.agentsStates;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return;
    }

    for (const [providerId, state] of Object.entries(raw as Record<string, unknown>)) {
        const sessionSubagent = sessionSubagentsByProviderId[providerId];
        if (!sessionSubagent || !state || typeof state !== 'object' || Array.isArray(state)) {
            continue;
        }
        const status = pickString((state as Record<string, unknown>).status);
        const statusMessage = pickString((state as Record<string, unknown>).message);
        const childTurn = subagentTurnIds.get(sessionSubagent) ?? opts.turn;
        const childOpts = {
            ...opts,
            ...(childTurn ? { turn: childTurn } : {}),
            subagent: sessionSubagent,
        } satisfies CreateEnvelopeOptions;
        if (statusMessage) {
            envelopes.push(createEnvelope('agent', {
                // This is provider-returned child output, not harness telemetry.
                // Retain it as ordinary sidechain text so the child panel exposes
                // the result to both the user and the main agent transcript.
                t: 'text',
                text: statusMessage,
            }, { ...childOpts, id: `${call}:${sessionSubagent}:result` }));
        }

        const terminal = collabTerminalOutcome(status);
        if (terminal) {
            maybeEmitSubagentStop(
                sessionSubagent,
                childOpts,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                envelopes,
                terminal,
                terminal === 'failed' || terminal === 'interrupted' ? statusMessage : undefined,
                true,
            );
        }
    }
}

function collabTerminalOutcome(status: string | undefined): SubagentStopStatus | null {
    switch (status) {
        case 'completed':
            return 'completed';
        case 'errored':
        case 'notFound':
            return 'failed';
        case 'interrupted':
            return 'interrupted';
        case 'shutdown':
            return 'cancelled';
        default:
            return null;
    }
}

function pickSubagentStopStatus(value: unknown): SubagentStopStatus {
    switch (value) {
        case 'completed':
            return 'completed';
        case 'failed':
        case 'errored':
        case 'notFound':
            return 'failed';
        case 'cancelled':
        case 'canceled':
        case 'shutdown':
            return 'cancelled';
        case 'interrupted':
        case 'aborted':
            return 'interrupted';
        default:
            return 'unknown';
    }
}

function pickErrorDetail(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
        return shortText(value.trim(), 1000);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const message = (value as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim().length > 0) {
            return shortText(message.trim(), 1000);
        }
    }
    return undefined;
}

function subagentActivityServiceText(kind: unknown, agentPath: string | undefined): string | undefined {
    if (kind === 'started') {
        return agentPath ? `Codex subagent started: ${agentPath}` : 'Codex subagent started';
    }
    if (kind === 'interrupted') {
        return 'Codex subagent interrupted';
    }
    return undefined;
}

function maybeEmitSubagentActivityService(
    envelopes: SessionEnvelope[],
    kind: unknown,
    agentPath: string | undefined,
    opts: CreateEnvelopeOptions,
    sessionSubagent: string,
): void {
    const text = subagentActivityServiceText(kind, agentPath);
    if (!text) {
        return;
    }
    envelopes.push(createEnvelope('agent', { t: 'service', text }, { ...opts, subagent: sessionSubagent }));
}

function registerCodexSubagents(
    providerIds: string[],
    title: string | undefined,
    providerSubagentToSessionSubagent: Map<string, string>,
    subagentTitles: Map<string, string>,
): { primarySubagent?: string; sessionSubagents: Record<string, string> } {
    const sessionSubagents: Record<string, string> = {};
    let primarySubagent: string | undefined;

    for (const providerId of providerIds) {
        const sessionSubagent = ensureSessionSubagent(providerId, providerSubagentToSessionSubagent);
        sessionSubagents[providerId] = sessionSubagent;
        if (!primarySubagent) {
            primarySubagent = sessionSubagent;
        }
        if (title) {
            subagentTitles.set(sessionSubagent, title);
        }
    }

    return { primarySubagent, sessionSubagents };
}

function collabArgs(
    message: Record<string, unknown>,
    primarySubagent: string | undefined,
    sessionSubagents: Record<string, string>,
): Record<string, unknown> {
    const sessionSubagentValues = Object.values(sessionSubagents);
    return {
        tool: pickString(message.tool) ?? 'unknown',
        status: pickString(message.status) ?? 'unknown',
        prompt: pickString(message.prompt) ?? null,
        model: pickString(message.model) ?? null,
        reasoningEffort: pickString(message.reasoning_effort ?? message.reasoningEffort) ?? null,
        agentStates: collabAgentStates(message, sessionSubagents),
        ...(primarySubagent ? { sessionSubagent: primarySubagent } : {}),
        ...(sessionSubagentValues.length > 0 ? { sessionSubagents: sessionSubagentValues } : {}),
    };
}

function summarizeCommand(command: unknown): string | null {
    if (typeof command === 'string' && command.trim().length > 0) {
        return command;
    }
    if (Array.isArray(command)) {
        const cmd = command.map(v => String(v)).join(' ').trim();
        return cmd.length > 0 ? cmd : null;
    }
    return null;
}

function commandToTitle(command: string | null): string {
    if (!command) {
        return 'Run command';
    }
    const short = command.length > 80 ? `${command.slice(0, 77)}...` : command;
    return `Run \`${short}\``;
}

export function turnTimestampMs(turn: ThreadTurn): number {
    const seconds = turn.startedAt ?? turn.completedAt;
    return typeof seconds === 'number' && Number.isFinite(seconds)
        ? seconds * 1000
        : Date.now();
}

export function completedTimestampMs(turn: ThreadTurn): number {
    const seconds = turn.completedAt ?? turn.startedAt;
    return typeof seconds === 'number' && Number.isFinite(seconds)
        ? seconds * 1000
        : Date.now();
}

function textFromInputItems(items: unknown): string | null {
    if (!Array.isArray(items)) {
        return null;
    }
    const text = items
        .filter((item): item is { type: 'text'; text: string } => (
            Boolean(item)
            && typeof item === 'object'
            && (item as { type?: unknown }).type === 'text'
            && typeof (item as { text?: unknown }).text === 'string'
        ))
        .map((item) => item.text)
        .join('\n')
        .trim();
    return text.length > 0 ? text : null;
}

function visibleCodexMessageText(text: string): string | null {
    // Imported/background-agent completions can appear in Codex thread images
    // as synthetic text items even though their output is already represented
    // by structured subagent envelopes. Keep only any real text after them.
    // Also strip Happy's own injected scaffolding (option-chips system prompt +
    // change-title instruction), which is baked into the Codex turn text and
    // would otherwise leak into the chat when a thread is reconstructed from a
    // fork / duplicate / side-chat backfill.
    const visibleText = stripLeadingTaskNotificationWrappers(stripHappySystemBlocks(text));
    return visibleText.trim().length > 0 ? visibleText : null;
}

function reasoningText(item: ThreadItem): string | null {
    const summary = (item as { summary?: unknown }).summary;
    const content = (item as { content?: unknown }).content;
    const parts = [
        ...(Array.isArray(summary) ? summary : []),
        ...(Array.isArray(content) ? content : []),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const text = parts.join('\n').trim();
    return text.length > 0 ? text : null;
}

export function turnStatus(turn: ThreadTurn): TurnEndStatus {
    const status = typeof turn.status === 'string' ? turn.status : null;
    if (status === 'failed') {
        return 'failed';
    }
    if (status === 'cancelled' || status === 'canceled' || status === 'aborted' || status === 'interrupted') {
        return 'cancelled';
    }
    return 'completed';
}

export function isCodexTurnInProgress(turn: ThreadTurn): boolean {
    const status = typeof turn.status === 'string' ? turn.status : null;
    return status === 'inProgress' || status === 'running' || status === 'active' || status === 'pending';
}

function emitHistoricalToolCall(
    envelopes: SessionEnvelope[],
    turn: ThreadTurn,
    item: ThreadItem,
    name: string,
    title: string,
    args: Record<string, unknown>,
    output: string | null,
    timestamps?: {
        startedAt: number;
        completedAt: number;
    },
): void {
    const time = timestamps?.startedAt ?? turnTimestampMs(turn);
    const opts = { turn: turn.id, time, codexItemId: item.id } satisfies CreateEnvelopeOptions;
    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-start',
        call: item.id,
        name,
        title,
        description: title,
        args,
    }, {
        ...opts,
        id: `${item.id}:start`,
    }));

    if (output && output.trim().length > 0) {
        envelopes.push(createEnvelope('agent', {
            t: 'text',
            text: output,
            thinking: true,
        }, {
            ...opts,
            id: `${item.id}:output`,
        }));
    }

    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-end',
        call: item.id,
    }, {
        ...opts,
        id: `${item.id}:end`,
        time: timestamps?.completedAt ?? completedTimestampMs(turn),
    }));
}

export function mapCodexThreadItemToSessionEnvelopes(
    turn: ThreadTurn,
    item: ThreadItem,
    timestamps?: {
        startedAt: number;
        completedAt: number;
    },
    state?: CodexTurnState,
): SessionEnvelope[] {
    const startedAt = timestamps?.startedAt ?? turnTimestampMs(turn);
    const completedAt = timestamps?.completedAt ?? completedTimestampMs(turn);
    const mappingState = state ?? { currentTurnId: turn.id };
    const startedSubagents = getStartedSubagents(mappingState);
    const activeSubagents = getActiveSubagents(mappingState);
    const subagentTurnIds = getSubagentTurnIds(mappingState);
    const subagentStops = getSubagentStops(mappingState);
    const providerSubagentToSessionSubagent = getProviderSubagentToSessionSubagent(mappingState);
    const subagentTitles = getSubagentTitles(mappingState);
    const collabReceiverThreadIdsByCall = getCollabReceiverThreadIdsByCall(mappingState);
    const collabToolByCall = getCollabToolByCall(mappingState);

    switch (item.type) {
        case 'userMessage': {
            const text = textFromInputItems(item.content);
            const visibleText = text ? visibleCodexMessageText(text) : null;
            return visibleText
                ? [createEnvelope('user', { t: 'text', text: visibleText }, {
                    id: item.id,
                    time: startedAt,
                    codexItemId: item.id,
                })]
                : [];
        }
        case 'agentMessage': {
            const text = typeof item.text === 'string' ? item.text.trim() : '';
            const visibleText = visibleCodexMessageText(text);
            if (!visibleText) {
                return [];
            }

            const subagent = resolveSessionSubagent(item as Record<string, unknown>, providerSubagentToSessionSubagent);
            const opts = {
                id: item.id,
                turn: subagent ? subagentTurnIds.get(subagent) ?? turn.id : turn.id,
                time: completedAt,
                codexItemId: item.id,
                ...(subagent ? { subagent } : {}),
            } satisfies CreateEnvelopeOptions;
            const envelopes: SessionEnvelope[] = [];
            maybeEmitSubagentStart(
                subagent,
                opts,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentTitles,
                envelopes,
            );
            envelopes.push(createEnvelope('agent', { t: 'text', text: visibleText }, opts));
            return envelopes;
        }
        case 'reasoning': {
            const text = reasoningText(item);
            if (!text) {
                return [];
            }

            const subagent = resolveSessionSubagent(item as Record<string, unknown>, providerSubagentToSessionSubagent);
            const opts = {
                id: item.id,
                turn: subagent ? subagentTurnIds.get(subagent) ?? turn.id : turn.id,
                time: startedAt,
                codexItemId: item.id,
                ...(subagent ? { subagent } : {}),
            } satisfies CreateEnvelopeOptions;
            const envelopes: SessionEnvelope[] = [];
            maybeEmitSubagentStart(
                subagent,
                opts,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentTitles,
                envelopes,
            );
            envelopes.push(createEnvelope('agent', { t: 'text', text, thinking: true }, opts));
            return envelopes;
        }
        case 'commandExecution': {
            const envelopes: SessionEnvelope[] = [];
            const command = typeof item.command === 'string' ? item.command : '';
            emitHistoricalToolCall(
                envelopes,
                turn,
                item,
                'CodexBash',
                commandToTitle(command),
                { command, cwd: item.cwd },
                typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : null,
                { startedAt, completedAt },
            );
            return envelopes;
        }
        case 'fileChange': {
            const envelopes: SessionEnvelope[] = [];
            emitHistoricalToolCall(
                envelopes,
                turn,
                item,
                'CodexPatch',
                'Apply patch',
                { changes: item.changes, status: item.status },
                null,
                { startedAt, completedAt },
            );
            return envelopes;
        }
        case 'mcpToolCall': {
            const envelopes: SessionEnvelope[] = [];
            const title = `${item.server}.${item.tool}`;
            const output = item.error !== undefined && item.error !== null
                ? String(item.error)
                : (item.result !== undefined && item.result !== null ? String(item.result) : null);
            emitHistoricalToolCall(
                envelopes,
                turn,
                item,
                'McpTool',
                title,
                {
                    server: item.server,
                    tool: item.tool,
                    arguments: item.arguments,
                },
                output,
                { startedAt, completedAt },
            );
            return envelopes;
        }
        case 'collabAgentToolCall': {
            const itemRecord = item as Record<string, unknown>;
            const tool = resolveCollabTool(item.id, itemRecord, collabToolByCall);
            const prompt = pickString(itemRecord.prompt);
            const title = collabToolTitle(tool, prompt);
            const providerIds = resolveCollabProviderIds(item.id, itemRecord, collabReceiverThreadIdsByCall);
            const { primarySubagent, sessionSubagents } = registerCodexSubagents(
                providerIds,
                title,
                providerSubagentToSessionSubagent,
                subagentTitles,
            );
            const startOpts = {
                turn: turn.id,
                time: startedAt,
                codexItemId: item.id,
            } satisfies CreateEnvelopeOptions;
            const endOpts = {
                turn: turn.id,
                time: completedAt,
                codexItemId: item.id,
            } satisfies CreateEnvelopeOptions;
            const envelopes: SessionEnvelope[] = [
                createEnvelope('agent', {
                    t: 'tool-call-start',
                    call: item.id,
                    name: 'CodexSubagent',
                    title,
                    description: collabToolDescription(tool, prompt),
                    args: collabArgs(itemRecord, primarySubagent, sessionSubagents),
                }, {
                    ...startOpts,
                    id: `${item.id}:start`,
                }),
            ];

            for (const sessionSubagent of Object.values(sessionSubagents)) {
                maybeEmitSubagentStart(
                    sessionSubagent,
                    startOpts,
                    startedSubagents,
                    activeSubagents,
                    subagentTurnIds,
                    subagentTitles,
                    envelopes,
                );
            }

            if (!isCollabCallInProgress(itemRecord)) {
                emitCollabAgentStateMessages(
                    envelopes,
                    itemRecord,
                    item.id,
                    sessionSubagents,
                    endOpts,
                    activeSubagents,
                    subagentTurnIds,
                    subagentStops,
                );
                envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call: item.id }, {
                    ...endOpts,
                    id: `${item.id}:end`,
                }));
                if (tool === 'closeAgent') {
                    for (const sessionSubagent of Object.values(sessionSubagents)) {
                        if (subagentStops.get(sessionSubagent)?.authoritative) {
                            continue;
                        }
                        maybeEmitSubagentStop(
                            sessionSubagent,
                            endOpts,
                            activeSubagents,
                            subagentTurnIds,
                            subagentStops,
                            envelopes,
                            'cancelled',
                        );
                    }
                }
                collabReceiverThreadIdsByCall.delete(item.id);
                collabToolByCall.delete(item.id);
            }
            return envelopes;
        }
        case 'subAgentActivity': {
            const itemRecord = item as Record<string, unknown>;
            const providerSubagent = pickString(itemRecord.agentThreadId ?? itemRecord.agent_thread_id);
            if (!providerSubagent) {
                return [];
            }
            const sessionSubagent = ensureSessionSubagent(providerSubagent, providerSubagentToSessionSubagent);
            const agentPath = pickString(itemRecord.agentPath ?? itemRecord.agent_path);
            if (agentPath) {
                subagentTitles.set(sessionSubagent, agentPath);
            }
            const opts = {
                turn: subagentTurnIds.get(sessionSubagent) ?? turn.id,
                time: startedAt,
                codexItemId: item.id,
            } satisfies CreateEnvelopeOptions;
            const envelopes: SessionEnvelope[] = [];
            maybeEmitSubagentStart(
                sessionSubagent,
                opts,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentTitles,
                envelopes,
            );
            maybeEmitSubagentActivityService(envelopes, itemRecord.kind, agentPath, opts, sessionSubagent);
            if (itemRecord.kind === 'interrupted') {
                maybeEmitSubagentStop(
                    sessionSubagent,
                    opts,
                    activeSubagents,
                    subagentTurnIds,
                    subagentStops,
                    envelopes,
                    'interrupted',
                    'Codex reported that the child was interrupted.',
                );
            }
            return envelopes;
        }
        default:
            return [];
    }
}

export function mapCodexThreadToSessionEnvelopes(thread: Pick<Thread, 'turns'>): SessionEnvelope[] {
    const envelopes: SessionEnvelope[] = [];
    const providerSubagentToSessionSubagent = new Map<string, string>();
    const subagentTitles = new Map<string, string>();
    const subagentTurnIds = new Map<string, string>();
    const subagentStops = new Map<string, { status: SubagentStopStatus; authoritative: boolean }>();
    const collabReceiverThreadIdsByCall = new Map<string, string[]>();
    const collabTurnIdsByCall = new Map<string, string>();
    const collabToolByCall = new Map<string, string>();

    for (const turn of thread.turns ?? []) {
        const startedAt = turnTimestampMs(turn);
        const completedAt = completedTimestampMs(turn);
        const state: CodexTurnState = {
            currentTurnId: turn.id,
            startedSubagents: new Set<string>(),
            activeSubagents: new Set<string>(),
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
        };
        envelopes.push(createEnvelope('agent', { t: 'turn-start' }, {
            id: `${turn.id}:start`,
            turn: turn.id,
            time: startedAt,
        }));

        const timestamps = { startedAt, completedAt };
        for (const item of turn.items ?? []) {
            envelopes.push(...mapCodexThreadItemToSessionEnvelopes(turn, item, timestamps, state));
        }

        if (!isCodexTurnInProgress(turn)) {
            envelopes.push(...emitSubagentStops(
                { turn: turn.id, time: completedAt },
                getActiveSubagents(state),
                getSubagentTurnIds(state),
                getSubagentStops(state),
                'unknown',
            ));
            envelopes.push(createEnvelope('agent', { t: 'turn-end', status: turnStatus(turn) }, {
                id: `${turn.id}:end`,
                turn: turn.id,
                time: completedAt,
            }));
        }
    }

    return envelopes;
}

function patchDescription(changes: unknown): string {
    if (!changes || typeof changes !== 'object') {
        return 'Applying patch';
    }
    const fileCount = Object.keys(changes as Record<string, unknown>).length;
    if (fileCount === 1) {
        return 'Applying patch to 1 file';
    }
    return `Applying patch to ${fileCount} files`;
}

function pickTurnEndStatus(message: Record<string, unknown>, type: unknown): TurnEndStatus {
    const rawStatus = message.status;
    if (rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled') {
        return rawStatus;
    }
    if (rawStatus === 'canceled') {
        return 'cancelled';
    }

    // Abort events are treated as cancelled unless they explicitly look like failures.
    if (type === 'turn_aborted') {
        const reason = message.reason;
        const error = message.error;
        if ((typeof reason === 'string' && /(fail|error)/i.test(reason))
            || (typeof error === 'string' && error.length > 0)
            || (error !== undefined && error !== null && typeof error === 'object')) {
            return 'failed';
        }
        return 'cancelled';
    }

    if (message.error !== undefined && message.error !== null) {
        return 'failed';
    }

    return 'completed';
}

export function mapCodexMcpMessageToSessionEnvelopes(message: Record<string, unknown>, state: CodexTurnState): CodexMapperResult {
    const type = message.type;
    const startedSubagents = getStartedSubagents(state);
    const activeSubagents = getActiveSubagents(state);
    const subagentTurnIds = getSubagentTurnIds(state);
    const subagentStops = getSubagentStops(state);
    const lastTurnId = state.lastTurnId ?? null;
    const providerSubagentToSessionSubagent = getProviderSubagentToSessionSubagent(state);
    const subagentTitles = getSubagentTitles(state);
    const collabReceiverThreadIdsByCall = getCollabReceiverThreadIdsByCall(state);
    const collabTurnIdsByCall = getCollabTurnIdsByCall(state);
    const collabToolByCall = getCollabToolByCall(state);

    if (type === 'task_started') {
        const turnId = pickString(message.turn_id ?? message.turnId) ?? createId();
        const turnStart = createEnvelope('agent', { t: 'turn-start' }, {
            id: `${turnId}:start`,
            turn: turnId,
        });
        return {
            currentTurnId: turnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes: [turnStart],
        };
    }

    if (type === 'task_complete' || type === 'turn_aborted') {
        if (!state.currentTurnId) {
            return {
                currentTurnId: null,
                lastTurnId,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                providerSubagentToSessionSubagent,
                subagentTitles,
                collabReceiverThreadIdsByCall,
                collabTurnIdsByCall,
                collabToolByCall,
                envelopes: [],
            };
        }

        const lifecycleOpts = { turn: state.currentTurnId } satisfies CreateEnvelopeOptions;
        return {
            currentTurnId: null,
            lastTurnId: state.currentTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes: [
                ...emitSubagentStops(
                    lifecycleOpts,
                    activeSubagents,
                    subagentTurnIds,
                    subagentStops,
                    'unknown',
                ),
                createEnvelope('agent', {
                    t: 'turn-end',
                    status: pickTurnEndStatus(message, type),
                }, { ...lifecycleOpts, id: `${state.currentTurnId}:end` }),
            ],
        };
    }

    if (type === 'token_count') {
        const usage = pickTokenUsage(message);
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes: usage
                // Deliberately NO turn id: app versions without the
                // usage-only-service filter render any agent service envelope
                // that has a turn as a chat row — one blank bubble per
                // token_count event. Turn-less agent envelopes are dropped by
                // those versions, while versions with the filter read the
                // usage either way.
                ? [createEnvelope('agent', { t: 'service', text: '' }, { usage })]
                : [],
        };
    }

    if (type === 'collab_agent_begin' || type === 'collab_agent_end') {
        const call = pickCallId(message, collabToolByCall, type === 'collab_agent_end');
        const tool = resolveCollabTool(call, message, collabToolByCall);
        const prompt = pickString(message.prompt);
        const title = collabToolTitle(tool, prompt);
        const providerIds = resolveCollabProviderIds(call, message, collabReceiverThreadIdsByCall);
        const { primarySubagent, sessionSubagents } = registerCodexSubagents(
            providerIds,
            title,
            providerSubagentToSessionSubagent,
            subagentTitles,
        );
        const fallbackTurnId = state.currentTurnId ?? lastTurnId;
        if (type === 'collab_agent_begin' && fallbackTurnId) {
            collabTurnIdsByCall.set(call, fallbackTurnId);
        }
        const turnOpts = buildEnvelopeOptions(collabTurnIdsByCall.get(call) ?? fallbackTurnId);
        const envelopes: SessionEnvelope[] = [];

        if (type === 'collab_agent_begin') {
            envelopes.push(createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexSubagent',
                title,
                description: collabToolDescription(tool, prompt),
                args: collabArgs(message, primarySubagent, sessionSubagents),
            }, { ...turnOpts, id: `${call}:start` }));

            for (const sessionSubagent of Object.values(sessionSubagents)) {
                maybeEmitSubagentStart(
                    sessionSubagent,
                    turnOpts,
                    startedSubagents,
                    activeSubagents,
                    subagentTurnIds,
                    subagentTitles,
                    envelopes,
                );
            }
        } else {
            // Codex can reveal child thread ids only when the spawn call ends.
            // Start the real sidechain here if the begin event was identity-free.
            for (const sessionSubagent of Object.values(sessionSubagents)) {
                maybeEmitSubagentStart(
                    sessionSubagent,
                    turnOpts,
                    startedSubagents,
                    activeSubagents,
                    subagentTurnIds,
                    subagentTitles,
                    envelopes,
                );
            }
            emitCollabAgentStateMessages(
                envelopes,
                message,
                call,
                sessionSubagents,
                turnOpts,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
            );
            envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call }, {
                ...turnOpts,
                id: `${call}:end`,
            }));
            if (tool === 'closeAgent') {
                for (const sessionSubagent of Object.values(sessionSubagents)) {
                    if (subagentStops.get(sessionSubagent)?.authoritative) {
                        continue;
                    }
                    maybeEmitSubagentStop(
                        sessionSubagent,
                        turnOpts,
                        activeSubagents,
                        subagentTurnIds,
                        subagentStops,
                        envelopes,
                        'cancelled',
                    );
                }
            }
            collabReceiverThreadIdsByCall.delete(call);
            collabToolByCall.delete(call);
        }

        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'subagent_activity') {
        const providerSubagent = pickString(message.agent_thread_id ?? message.agentThreadId);
        if (!providerSubagent) {
            return {
                currentTurnId: state.currentTurnId,
                lastTurnId,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                providerSubagentToSessionSubagent,
                subagentTitles,
                collabReceiverThreadIdsByCall,
                collabTurnIdsByCall,
                collabToolByCall,
                envelopes: [],
            };
        }

        const sessionSubagent = ensureSessionSubagent(providerSubagent, providerSubagentToSessionSubagent);
        const agentPath = pickString(message.agent_path ?? message.agentPath);
        if (agentPath) {
            subagentTitles.set(sessionSubagent, agentPath);
        }
        const turnOpts = buildEnvelopeOptions(
            subagentTurnIds.get(sessionSubagent) ?? state.currentTurnId ?? lastTurnId,
        );
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(
            sessionSubagent,
            turnOpts,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentTitles,
            envelopes,
        );
        maybeEmitSubagentActivityService(envelopes, message.kind, agentPath, turnOpts, sessionSubagent);
        if (message.kind === 'interrupted') {
            maybeEmitSubagentStop(
                sessionSubagent,
                turnOpts,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                envelopes,
                'interrupted',
                'Codex reported that the child was interrupted.',
            );
        }

        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'subagent_terminal') {
        const providerSubagent = pickString(message.agent_thread_id ?? message.agentThreadId);
        if (!providerSubagent) {
            return {
                currentTurnId: state.currentTurnId,
                lastTurnId,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                providerSubagentToSessionSubagent,
                subagentTitles,
                collabReceiverThreadIdsByCall,
                collabTurnIdsByCall,
                collabToolByCall,
                envelopes: [],
            };
        }

        const sessionSubagent = ensureSessionSubagent(providerSubagent, providerSubagentToSessionSubagent);
        const turnOpts = buildEnvelopeOptions(
            subagentTurnIds.get(sessionSubagent) ?? state.currentTurnId ?? lastTurnId,
        );
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(
            sessionSubagent,
            turnOpts,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentTitles,
            envelopes,
        );
        const status = pickSubagentStopStatus(message.status);
        const detail = status === 'failed' || status === 'interrupted'
            ? pickErrorDetail(message.error ?? message.detail)
            : undefined;
        maybeEmitSubagentStop(
            sessionSubagent,
            turnOpts,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            envelopes,
            status,
            detail,
            true,
        );

        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    const subagent = resolveSessionSubagent(message, providerSubagentToSessionSubagent);
    const opts = buildEnvelopeOptions(
        subagent
            ? subagentTurnIds.get(subagent) ?? state.currentTurnId ?? lastTurnId
            : state.currentTurnId,
        subagent,
    );

    if (type === 'agent_message') {
        if (typeof message.message !== 'string') {
            return {
                currentTurnId: state.currentTurnId,
                lastTurnId,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                providerSubagentToSessionSubagent,
                subagentTitles,
                collabReceiverThreadIdsByCall,
                collabTurnIdsByCall,
                collabToolByCall,
                envelopes: [],
            };
        }

        const visibleText = visibleCodexMessageText(message.message);
        if (!visibleText) {
            return {
                currentTurnId: state.currentTurnId,
                lastTurnId,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                providerSubagentToSessionSubagent,
                subagentTitles,
                collabReceiverThreadIdsByCall,
                collabTurnIdsByCall,
                collabToolByCall,
                envelopes: [],
            };
        }

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'text', text: visibleText }, opts));
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'agent_reasoning' || type === 'agent_reasoning_delta') {
        const text = typeof message.text === 'string'
            ? message.text
            : (typeof message.delta === 'string' ? message.delta : null);

        if (!text) {
            return {
                currentTurnId: state.currentTurnId,
                lastTurnId,
                startedSubagents,
                activeSubagents,
                subagentTurnIds,
                subagentStops,
                providerSubagentToSessionSubagent,
                subagentTitles,
                collabReceiverThreadIdsByCall,
                collabTurnIdsByCall,
                collabToolByCall,
                envelopes: [],
            };
        }

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'text', text, thinking: true }, opts));
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'mcp_tool_begin') {
        const call = pickCallId(message);
        const server = pickString(message.server) ?? 'mcp';
        const tool = pickString(message.tool) ?? 'tool';
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(createEnvelope('agent', {
            t: 'tool-call-start',
            call,
            name: 'McpTool',
            title: `${server}.${tool}`,
            description: `${server}.${tool}`,
            args: {
                server,
                tool,
                arguments: message.arguments,
            },
        }, opts));
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'mcp_tool_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call }, opts));
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    // exec_approval_request is intentionally NOT mapped here — the permission
    // handler already renders the approval UI via agent state.  Mapping it to
    // tool-call-start too would create a duplicate tool call card.
    if (type === 'exec_command_begin') {
        const call = pickCallId(message);
        const { call_id: _callIdSnake, callId: _callIdCamel, type: _type, ...args } = message;

        const command = summarizeCommand((args as Record<string, unknown>).command);
        const description = typeof (args as Record<string, unknown>).description === 'string'
            ? ((args as Record<string, string>).description)
            : (command ?? 'Execute command');

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexBash',
                title: commandToTitle(command),
                description,
                args: args as Record<string, unknown>,
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'exec_command_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call }, opts));
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'patch_apply_begin') {
        const call = pickCallId(message);
        const autoApproved = (message as { auto_approved?: unknown }).auto_approved;
        const changes = (message as { changes?: unknown }).changes;

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexPatch',
                title: 'Apply patch',
                description: patchDescription(changes),
                args: {
                    auto_approved: autoApproved,
                    changes,
                },
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    if (type === 'patch_apply_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, subagentTurnIds, subagentTitles, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call }, opts));
        return {
            currentTurnId: state.currentTurnId,
            lastTurnId,
            startedSubagents,
            activeSubagents,
            subagentTurnIds,
            subagentStops,
            providerSubagentToSessionSubagent,
            subagentTitles,
            collabReceiverThreadIdsByCall,
            collabTurnIdsByCall,
            collabToolByCall,
            envelopes,
        };
    }

    return {
        currentTurnId: state.currentTurnId,
        lastTurnId,
        startedSubagents,
        activeSubagents,
        subagentTurnIds,
        subagentStops,
        providerSubagentToSessionSubagent,
        subagentTitles,
        collabReceiverThreadIdsByCall,
        collabTurnIdsByCall,
        collabToolByCall,
        envelopes: [],
    };
}

export function mapCodexProcessorMessageToSessionEnvelopes(
    message: ReasoningOutput | DiffToolCall | DiffToolResult,
    state: CodexTurnState,
): SessionEnvelope[] {
    const toolLikeMessage = message as LegacyToolLikeMessage;
    const opts = buildEnvelopeOptions(state.currentTurnId);

    if (message.type === 'reasoning') {
        return [createEnvelope('agent', {
            t: 'text',
            text: message.message,
            thinking: true,
        }, opts)];
    }

    if (message.type === 'tool-call') {
        const title = typeof (toolLikeMessage.input as { title?: unknown } | undefined)?.title === 'string'
            ? (toolLikeMessage.input as { title: string }).title
            : `${toolLikeMessage.name || 'Tool'} call`;

        return [createEnvelope('agent', {
            t: 'tool-call-start',
            call: toolLikeMessage.callId,
            name: toolLikeMessage.name || 'unknown',
            title,
            description: title,
            args: (toolLikeMessage.input && typeof toolLikeMessage.input === 'object'
                ? toolLikeMessage.input
                : {}) as Record<string, unknown>,
        }, opts)];
    }

    if (message.type === 'tool-call-result') {
        const envelopes: SessionEnvelope[] = [];
        const content = toolLikeMessage.output?.content;
        if (typeof content === 'string' && content.trim().length > 0) {
            envelopes.push(createEnvelope('agent', {
                t: 'text',
                text: content,
                thinking: true,
            }, opts));
        }
        envelopes.push(createEnvelope('agent', {
            t: 'tool-call-end',
            call: toolLikeMessage.callId,
        }, opts));
        return envelopes;
    }

    return [];
}
