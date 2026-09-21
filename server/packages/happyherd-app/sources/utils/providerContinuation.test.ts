import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/typesMessage';
import type { Session } from '@/sync/storageTypes';
import {
    buildProviderContinuationPrompt,
    getProviderContinuationSource,
    getProviderContinuationTarget,
    selectProviderContinuationSessions,
} from './providerContinuation';

function user(id: string, createdAt: number, text: string): Extract<Message, { kind: 'user-text' }> {
    return { kind: 'user-text', id, localId: null, createdAt, text };
}

function agent(id: string, createdAt: number, text: string, isThinking = false): Extract<Message, { kind: 'agent-text' }> {
    return { kind: 'agent-text', id, localId: null, createdAt, text, isThinking };
}

function session(id: string, createdAt: number, continuedFromSessionId?: string): Session {
    return {
        id,
        seq: 1,
        createdAt,
        updatedAt: createdAt,
        active: true,
        activeAt: createdAt,
        metadata: {
            path: '/workspace',
            host: 'test-host',
            flavor: id.includes('codex') ? 'codex' : 'claude',
            continuedFromSessionId,
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

describe('provider continuation', () => {
    it('offers only the opposite supported provider', () => {
        expect(getProviderContinuationSource(undefined)).toBe('claude');
        expect(getProviderContinuationSource(null)).toBe('claude');
        expect(getProviderContinuationTarget('claude')).toBe('codex');
        expect(getProviderContinuationTarget(undefined)).toBe('codex');
        expect(getProviderContinuationTarget(null)).toBe('codex');
        expect(getProviderContinuationTarget('codex')).toBe('claude');
        expect(getProviderContinuationTarget('grok')).toBeNull();
    });

    it('hands off only recent visible text and states the fresh-session boundary', () => {
        const prompt = buildProviderContinuationPrompt({
            sourceProvider: 'claude',
            targetProvider: 'codex',
            messages: [
                user('old', 1, 'oldest omitted'),
                user('u1', 2, 'first retained'),
                agent('thinking', 3, 'private chain of thought', true),
                {
                    kind: 'tool-call',
                    id: 'tool',
                    localId: null,
                    createdAt: 4,
                    tool: {
                        name: 'Read', state: 'completed', input: { secret: 'tool payload' },
                        createdAt: 4, startedAt: 4, completedAt: 4, description: null,
                    },
                    children: [],
                },
                agent('a1', 5, 'second retained'),
                user('u2', 6, 'third retained'),
                agent('a2', 7, 'newest retained'),
            ],
        });

        expect(prompt).toContain('fresh Codex session');
        expect(prompt).toContain('does not share the Claude provider native conversation state');
        expect(prompt).toContain('first retained');
        expect(prompt).toContain('newest retained');
        expect(prompt).not.toContain('oldest omitted');
        expect(prompt).not.toContain('private chain of thought');
        expect(prompt).not.toContain('tool payload');
        expect(prompt.indexOf('first retained')).toBeLessThan(prompt.indexOf('newest retained'));
    });

    it('uses the rendered display projection and omits hidden prompt payloads', () => {
        const prompt = buildProviderContinuationPrompt({
            sourceProvider: 'claude',
            targetProvider: 'codex',
            messages: [
                {
                    ...user('attachment', 1, 'HIDDEN_ATTACHMENT_SENTINEL'),
                    displayText: '📎 Attached workspace context: "notes.md"\n\nReview the notes',
                },
                user(
                    'caveat',
                    2,
                    '<local-command-caveat>HIDDEN_COMMAND_CAVEAT_SENTINEL</local-command-caveat>',
                ),
                {
                    ...user('prior-handoff', 3, 'HIDDEN_PRIOR_HANDOFF_SENTINEL'),
                    displayText: 'Continue from Codex session',
                    meta: { providerContinuationHandoff: true },
                },
                agent('answer', 4, 'Visible answer'),
            ],
        });

        expect(prompt).toContain('Attached workspace context: "notes.md"');
        expect(prompt).toContain('Review the notes');
        expect(prompt).toContain('Visible answer');
        expect(prompt).not.toContain('HIDDEN_ATTACHMENT_SENTINEL');
        expect(prompt).not.toContain('HIDDEN_COMMAND_CAVEAT_SENTINEL');
        expect(prompt).not.toContain('HIDDEN_PRIOR_HANDOFF_SENTINEL');
        expect(prompt).not.toContain('Continue from Codex session');
    });

    it('caps the complete recent-context section without dropping the newest turn', () => {
        const prompt = buildProviderContinuationPrompt({
            sourceProvider: 'codex',
            targetProvider: 'claude',
            messages: [
                user('older', 1, 'older context'),
                agent('middle', 2, 'middle context'),
                user('u', 3, `newest-${'x'.repeat(10_000)}`),
            ],
        });
        const contextStart = prompt.indexOf('\n\nRecent Chronological Conversation Messages\n\n');
        const context = prompt.slice(contextStart);

        expect(contextStart).toBeGreaterThan(0);
        expect(prompt).toContain('newest-');
        expect(context.length).toBeLessThanOrEqual(6_000);
        expect(context.length).toBe(6_000);
    });

    it('selects newest active targets for reverse navigation', () => {
        const archived = session('codex-archived', 30, 'source');
        archived.metadata!.lifecycleState = 'archived';
        const sessions = {
            source: session('source', 1),
            older: session('codex-older', 10, 'source'),
            newest: session('codex-newest', 20, 'source'),
            archived,
            unrelated: session('codex-other', 40, 'other'),
        };

        expect(selectProviderContinuationSessions(sessions, 'source').map((item) => item.id))
            .toEqual(['codex-newest', 'codex-older']);
        expect(selectProviderContinuationSessions(sessions, null)).toEqual([]);
    });
});
