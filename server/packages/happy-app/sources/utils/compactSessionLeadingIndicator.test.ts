import { describe, expect, it } from 'vitest';

import { resolveCompactSessionLeadingIndicatorKind } from './compactSessionLeadingIndicator';

describe('compact session leading indicator', () => {
    it('preserves the original indicator precedence while Commander pictures are disabled', () => {
        expect(resolveCompactSessionLeadingIndicatorKind({
            commanderId: 'athena',
            commanderProfilePictures: false,
            hasDraft: false,
            hasUnread: true,
            state: 'thinking',
        })).toBe('unread');
        expect(resolveCompactSessionLeadingIndicatorKind({
            commanderId: 'athena',
            commanderProfilePictures: false,
            hasDraft: true,
            hasUnread: false,
            state: 'waiting',
        })).toBe('draft');
        expect(resolveCompactSessionLeadingIndicatorKind({
            commanderId: 'athena',
            commanderProfilePictures: false,
            hasDraft: false,
            hasUnread: false,
            state: 'permission_required',
        })).toBe('activity');
    });

    it('uses the Commander avatar only when the experiment and identity are both present', () => {
        expect(resolveCompactSessionLeadingIndicatorKind({
            commanderId: 'athena',
            commanderProfilePictures: true,
            hasDraft: true,
            hasUnread: true,
            state: 'thinking',
        })).toBe('commander-avatar');
        expect(resolveCompactSessionLeadingIndicatorKind({
            commanderProfilePictures: true,
            hasDraft: false,
            hasUnread: false,
            state: 'thinking',
        })).toBe('activity');
    });
});
