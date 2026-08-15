import { describe, expect, it } from 'vitest';
import type { Session } from './storageTypes';
import {
    filterSessionsForTopLevelLists,
    getRecentTopLevelSessions,
    isSessionVisibleInTopLevelLists,
} from './sessionListVisibility';

function session(
    metadata: Partial<NonNullable<Session['metadata']>> = {},
    active = false,
): Session {
    return {
        metadata: { path: '/srv/workspace', host: 'machine-one', ...metadata },
        active,
    } as Session;
}

describe('isSessionVisibleInTopLevelLists', () => {
    it('keeps ordinary conversations visible', () => {
        expect(isSessionVisibleInTopLevelLists(session())).toBe(true);
    });

    it('keeps side chats out of top-level lists', () => {
        expect(isSessionVisibleInTopLevelLists(session({ isSideChat: true }))).toBe(false);
    });

    it('keeps running and completed automation sessions out of top-level lists', () => {
        const automationMetadata = {
            automationId: '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8',
            automationKind: 'scheduled' as const,
        };

        expect(isSessionVisibleInTopLevelLists(session(automationMetadata, true))).toBe(false);
        expect(isSessionVisibleInTopLevelLists(session(automationMetadata, false))).toBe(false);
    });

    it('treats either automation provenance field as sufficient to hide a run', () => {
        expect(isSessionVisibleInTopLevelLists(session({
            automationId: '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8',
        }))).toBe(false);
        expect(isSessionVisibleInTopLevelLists(session({
            automationKind: 'scheduled',
        }))).toBe(false);
    });

    it('leaves no list rows when a group contains only automation sessions', () => {
        const automationOnly = [
            session({ automationId: '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8' }, true),
            session({ automationId: '2990a819-a0d8-481a-8955-7c5789c931ef' }, false),
        ];

        expect(filterSessionsForTopLevelLists(automationOnly)).toEqual([]);
    });

    it('filters automation runs before selecting Recent sessions', () => {
        const automationRuns = Array.from({ length: 6 }, (_, index) => ({
            ...session({
                automationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            }),
            id: `automation-${index}`,
            updatedAt: 100 - index,
        }));
        const conversation = {
            ...session(),
            id: 'conversation',
            updatedAt: 1,
        };

        expect(getRecentTopLevelSessions([...automationRuns, conversation], 5))
            .toEqual([conversation]);
    });
});
