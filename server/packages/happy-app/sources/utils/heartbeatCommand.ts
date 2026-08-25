import {
    HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION,
    type HappyHerdHeartbeatControlInput,
    type HappyHerdHeartbeatControlResponse,
} from '@slopus/happy-wire';

type Translate = (key: any, params?: Record<string, string | number>) => string;

export type ParsedHeartbeatCommand =
    | { recognized: false }
    | { recognized: true; valid: false }
    | { recognized: true; valid: true; action: 'status' | 'pause' | 'resume' | 'clear' }
    | { recognized: true; valid: true; action: 'set'; intervalSeconds: number; instruction: string | null };

const DURATION_MULTIPLIERS: Record<string, number> = {
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1,
    m: 60,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    h: 3_600,
    hr: 3_600,
    hrs: 3_600,
    hour: 3_600,
    hours: 3_600,
    d: 86_400,
    day: 86_400,
    days: 86_400,
};

type HeartbeatSessionMetadata = {
    flavor?: string | null;
    claudeSessionId?: string | null;
    codexThreadId?: string | null;
} | null | undefined;

function isHeartbeatAvailable(metadata: HeartbeatSessionMetadata): boolean {
    const flavor = metadata?.flavor ?? 'claude';
    return (flavor === 'claude' && Boolean(metadata?.claudeSessionId))
        || (flavor === 'codex' && Boolean(metadata?.codexThreadId));
}

function parseHeartbeatCommand(text: string): ParsedHeartbeatCommand {
    const names = [HEARTBEAT_COMMAND.name, ...HEARTBEAT_COMMAND.aliases].join('|');
    const match = text.trim().match(new RegExp(`^/(${names})(?:\\s+([\\s\\S]*))?$`, 'i'));
    if (!match) return { recognized: false };
    const body = match[2]?.trim() ?? '';
    if (!body) return { recognized: true, valid: true, action: 'status' };
    const lifecycleAction = HEARTBEAT_COMMAND.actions.find((action) => action.toLowerCase() === body.toLowerCase());
    if (lifecycleAction) return { recognized: true, valid: true, action: lifecycleAction };

    const set = body.match(/^every\s+([1-9]\d*)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)(?:\s+([\s\S]+))?$/i);
    if (!set) return { recognized: true, valid: false };
    const intervalSeconds = Number(set[1]) * DURATION_MULTIPLIERS[set[2].toLowerCase()];
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) {
        return { recognized: true, valid: false };
    }
    return {
        recognized: true,
        valid: true,
        action: 'set',
        intervalSeconds,
        instruction: set[3] ?? null,
    };
}

function heartbeatCommandSuggestions(translate: Translate): Array<{ command: string; description: string }> {
    const description = translate(HEARTBEAT_COMMAND.descriptionKey);
    return [HEARTBEAT_COMMAND.name, ...HEARTBEAT_COMMAND.aliases].map((command) => ({ command, description }));
}

function compactInterval(intervalSeconds: number): string {
    if (intervalSeconds % 86_400 === 0) return `${intervalSeconds / 86_400}d`;
    if (intervalSeconds % 3_600 === 0) return `${intervalSeconds / 3_600}h`;
    if (intervalSeconds % 60 === 0) return `${intervalSeconds / 60}m`;
    return `${intervalSeconds}s`;
}

function compactCountdown(seconds: number): string {
    if (seconds >= 86_400) return `${Math.ceil(seconds / 86_400)}d`;
    if (seconds >= 3_600) return `${Math.ceil(seconds / 3_600)}h`;
    if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
    return `${seconds}s`;
}

function heartbeatRunStatus(
    status: 'started' | 'completed' | 'failed',
    translate: Translate,
): string {
    return translate(`happyHerd.heartbeat.delivery.${status === 'started' ? 'running' : status}`);
}

export interface HeartbeatStatusPresentation {
    summary: string;
    details: string[];
}

export function formatHeartbeatStatusPresentation(
    response: HappyHerdHeartbeatControlResponse,
    translate: Translate,
): HeartbeatStatusPresentation {
    if (!response.heartbeat) {
        return { summary: translate('happyHerd.heartbeat.notConfigured'), details: [] };
    }
    const heartbeat = response.heartbeat;
    const state = heartbeat.status === 'paused'
        ? translate('happyHerd.heartbeat.paused')
        : response.deliveryState
            ? translate(`happyHerd.heartbeat.delivery.${response.deliveryState}`)
            : translate('happyHerd.heartbeat.active');
    const deliveredRun = response.currentRun?.status === 'started' && response.currentRun.sessionId
        ? response.currentRun
        : response.lastRun?.sessionId
            ? response.lastRun
            : null;
    const lastDelivery = deliveredRun
        ? translate('happyHerd.heartbeat.lastDelivery', {
            time: new Date(deliveredRun.startedAt).toLocaleString(),
            status: heartbeatRunStatus(deliveredRun.status as 'started' | 'completed' | 'failed', translate),
        })
        : translate('happyHerd.heartbeat.lastDeliveryNone');
    let nextDue = translate('happyHerd.heartbeat.nextDueNone');
    if (heartbeat.nextDueAt) {
        const remainingSeconds = Math.max(0, Math.ceil(
            (Date.parse(heartbeat.nextDueAt) - Date.parse(response.observedAt)) / 1_000,
        ));
        const countdown = remainingSeconds === 0
            ? translate('happyHerd.heartbeat.dueNow')
            : translate('happyHerd.heartbeat.countdownIn', { duration: compactCountdown(remainingSeconds) });
        nextDue = translate('happyHerd.heartbeat.nextDue', {
            time: new Date(heartbeat.nextDueAt).toLocaleString(),
            countdown,
        });
    }
    const instruction = heartbeat.instruction === HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION
        ? translate('happyHerd.heartbeat.standardContinuation')
        : heartbeat.instruction;
    return {
        summary: translate('happyHerd.heartbeat.confirmation', {
            cadence: compactInterval(heartbeat.intervalSeconds),
            state,
        }),
        details: [
            translate('happyHerd.heartbeat.currentStatus', { state }),
            ...(response.deliveryState === 'queued' && response.queuedAhead !== null
                ? [translate('happyHerd.heartbeat.queuedAhead', { count: response.queuedAhead })]
                : []),
            lastDelivery,
            nextDue,
            translate('happyHerd.heartbeat.instructionStatus', { instruction }),
        ],
    };
}

export function formatHeartbeatControlResult(
    response: HappyHerdHeartbeatControlResponse,
    translate: Translate,
): string {
    const presentation = formatHeartbeatStatusPresentation(response, translate);
    return [presentation.summary, ...presentation.details].join('\n');
}

async function dispatchHeartbeatCommand(input: {
    text: string;
    machineId: string;
    sessionId: string;
    metadata: HeartbeatSessionMetadata;
    hasAttachments: boolean;
    hasWorkspaceContext: boolean;
    translate: Translate;
    control: (machineId: string, action: HappyHerdHeartbeatControlInput) => Promise<HappyHerdHeartbeatControlResponse>;
}): Promise<{ handled: boolean; clearComposer: boolean; message?: string }> {
    if (!isHeartbeatAvailable(input.metadata)) return { handled: false, clearComposer: false };
    const parsed = parseHeartbeatCommand(input.text);
    if (!parsed.recognized) return { handled: false, clearComposer: false };
    if (!parsed.valid) {
        return {
            handled: true,
            clearComposer: false,
            message: input.translate('happyHerd.heartbeat.usage', { usage: HEARTBEAT_COMMAND.usage }),
        };
    }
    if (input.hasAttachments || input.hasWorkspaceContext) {
        return {
            handled: true,
            clearComposer: false,
            message: input.translate('happyHerd.heartbeat.textOnly'),
        };
    }
    const action: HappyHerdHeartbeatControlInput = parsed.action === 'set'
        ? {
            action: 'set',
            targetSessionId: input.sessionId,
            intervalSeconds: parsed.intervalSeconds,
            instruction: parsed.instruction,
        }
        : { action: parsed.action, targetSessionId: input.sessionId };
    const response = await input.control(input.machineId, action);
    return {
        handled: true,
        clearComposer: true,
        message: formatHeartbeatControlResult(response, input.translate),
    };
}

export const HEARTBEAT_COMMAND = {
    name: 'heartbeat',
    aliases: ['hb'] as const,
    actions: ['status', 'pause', 'resume', 'clear'] as const,
    usage: '/heartbeat every <interval> [instruction]',
    descriptionKey: 'happyHerd.heartbeat.commandDescription',
    isAvailable: isHeartbeatAvailable,
    parse: parseHeartbeatCommand,
    suggestions: heartbeatCommandSuggestions,
    dispatch: dispatchHeartbeatCommand,
} as const;
