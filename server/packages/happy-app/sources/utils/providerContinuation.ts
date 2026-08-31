import type { Message } from '@/sync/typesMessage';
import type { Session } from '@/sync/storageTypes';
import { visibleUserMessageText } from '@/components/parseLocalCommandMessage';

export type ProviderContinuationProvider = 'claude' | 'codex';

const RECENT_MESSAGE_LIMIT = 4;
const CONTEXT_CHARACTER_LIMIT = 6_000;
const CONTEXT_HEADING = 'Recent Chronological Conversation Messages';
const CONTEXT_PREFIX = `\n\n${CONTEXT_HEADING}\n\n`;
const EMPTY_CONTINUATIONS: Session[] = [];

export function getProviderContinuationSource(
    flavor: string | null | undefined,
): ProviderContinuationProvider | null {
    // Historical Happy sessions predate explicit flavor metadata and are
    // treated as Claude everywhere else in the supported session surface.
    if (flavor == null || flavor === 'claude') return 'claude';
    if (flavor === 'codex') return 'codex';
    return null;
}

export function getProviderContinuationTarget(
    flavor: string | null | undefined,
): ProviderContinuationProvider | null {
    const source = getProviderContinuationSource(flavor);
    if (source === 'claude') return 'codex';
    if (source === 'codex') return 'claude';
    return null;
}

export function getProviderContinuationLabel(provider: ProviderContinuationProvider): 'Claude' | 'Codex' {
    return provider === 'claude' ? 'Claude' : 'Codex';
}

/**
 * Build a deliberately bounded handoff from recent visible conversation text.
 * Tool payloads, thinking, attachments, and the full transcript stay in the
 * source session; the target provider receives only the last visible turns.
 */
export function buildProviderContinuationPrompt(input: {
    messages: readonly Message[];
    sourceProvider: ProviderContinuationProvider;
    targetProvider: ProviderContinuationProvider;
}): string {
    const visible = input.messages
        .flatMap((message) => {
            if (message.kind === 'user-text') {
                if (message.meta?.providerContinuationHandoff === true) return [];
                const text = visibleUserMessageText(message, input.sourceProvider)?.trim();
                return text ? [{ createdAt: message.createdAt, role: 'User', text }] : [];
            }
            if (message.kind === 'agent-text' && !message.isThinking && message.text.trim()) {
                return [{ createdAt: message.createdAt, role: 'Assistant', text: message.text.trim() }];
            }
            return [];
        })
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-RECENT_MESSAGE_LIMIT);

    let remaining = CONTEXT_CHARACTER_LIMIT - CONTEXT_PREFIX.length;
    const blocks: string[] = [];
    for (let index = visible.length - 1; index >= 0 && remaining > 0; index -= 1) {
        const message = visible[index];
        const prefix = `${message.role}:\n`;
        const separatorLength = blocks.length > 0 ? 2 : 0;
        const availableForText = remaining - separatorLength - prefix.length;
        if (availableForText <= 0) break;
        const text = message.text.length > availableForText
            ? availableForText === 1
                ? '…'
                : `${message.text.slice(0, availableForText - 1)}…`
            : message.text;
        const block = `${prefix}${text}`;
        blocks.unshift(block);
        remaining -= separatorLength + block.length;
    }

    const source = getProviderContinuationLabel(input.sourceProvider);
    const target = getProviderContinuationLabel(input.targetProvider);
    const context = blocks.length > 0
        ? `${CONTEXT_PREFIX}${blocks.join('\n\n')}`
        : '';

    return [
        `Work continues from the linked ${source} session into this fresh ${target} session.`,
        'The current workspace files are authoritative.',
        `The ${target} session does not share the ${source} provider native conversation state.${context}`,
    ].join('\n');
}

/** Newest active continuation first, for source-to-target navigation. */
export function selectProviderContinuationSessions(
    sessions: Readonly<Record<string, Session>>,
    sourceSessionId: string | null,
): Session[] {
    if (!sourceSessionId) return EMPTY_CONTINUATIONS;

    const matches = Object.values(sessions).filter((session) => (
        session.metadata?.continuedFromSessionId === sourceSessionId
        && session.metadata.lifecycleState !== 'archived'
    ));
    if (matches.length === 0) return EMPTY_CONTINUATIONS;
    matches.sort((left, right) => right.createdAt - left.createdAt);
    return matches;
}
