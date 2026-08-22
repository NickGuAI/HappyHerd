import type { SessionState } from '@/utils/sessionUtils';

export type CompactSessionLeadingIndicatorKind =
    | 'commander-avatar'
    | 'unread'
    | 'draft'
    | 'activity'
    | 'waiting'
    | 'none';

export function resolveCompactSessionLeadingIndicatorKind(options: {
    commanderId?: string | null;
    commanderProfilePictures: boolean;
    hasDraft: boolean;
    hasUnread: boolean;
    state: SessionState;
}): CompactSessionLeadingIndicatorKind {
    if (options.commanderProfilePictures && options.commanderId) return 'commander-avatar';
    if (options.hasUnread) return 'unread';
    if (options.state === 'waiting' && options.hasDraft) return 'draft';
    if (options.state === 'permission_required' || options.state === 'thinking') return 'activity';
    if (options.state === 'waiting') return 'waiting';
    return 'none';
}
