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
});
