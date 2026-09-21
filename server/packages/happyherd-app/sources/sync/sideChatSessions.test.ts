import { describe, expect, it } from 'vitest';

import type { Session } from './storageTypes';
import { selectSideChatSessions } from './sideChatSessions';

function session(
    id: string,
    createdAt: number,
    metadata: Partial<NonNullable<Session['metadata']>>,
): Session {
    return {
        id,
        createdAt,
        updatedAt: createdAt,
        active: true,
        metadata: { path: '/srv/project', host: 'machine-one', ...metadata },
    } as Session;
}

describe('selectSideChatSessions', () => {
    it('returns only live children of the exact parent in stable oldest-first order', () => {
        const sessions = {
            newest: session('newest', 30, { isSideChat: true, parentSessionId: 'parent' }),
            ordinary: session('ordinary', 5, {}),
            providerNativeInline: session('provider-native-inline', 6, {
                activity: {
                    subagents: { running: 1, queued: 0, total: 1 },
                    workflows: { running: 0, total: 0 },
                    processes: { running: 0 },
                    tasks: { pending: 0, inProgress: 0, completed: 0, total: 0 },
                },
            }),
            archived: session('archived', 10, {
                isSideChat: true,
                parentSessionId: 'parent',
                lifecycleState: 'archived',
            }),
            stopped: {
                ...session('stopped', 15, { isSideChat: true, parentSessionId: 'parent' }),
                active: false,
            },
            sibling: session('sibling', 20, { isSideChat: true, parentSessionId: 'other-parent' }),
            oldest: session('oldest', 1, { isSideChat: true, parentSessionId: 'parent' }),
        };

        expect(selectSideChatSessions(sessions, 'parent').map((item) => item.id))
            .toEqual(['oldest', 'stopped', 'newest']);
        expect(selectSideChatSessions(sessions, 'other-parent').map((item) => item.id))
            .toEqual(['sibling']);
        expect(selectSideChatSessions(sessions, null)).toEqual([]);
    });

    it('does not turn provider-native inline subagent activity into a side-chat conversation', () => {
        const sessions = {
            parent: session('parent', 1, {
                activity: {
                    subagents: { running: 2, queued: 1, total: 3 },
                    workflows: { running: 0, total: 0 },
                    processes: { running: 0 },
                    tasks: { pending: 0, inProgress: 0, completed: 0, total: 0 },
                },
            }),
            durableChild: session('durable-child', 2, {
                isSideChat: true,
                parentSessionId: 'parent',
            }),
        };

        expect(selectSideChatSessions(sessions, 'parent').map((item) => item.id))
            .toEqual(['durable-child']);
    });
});
