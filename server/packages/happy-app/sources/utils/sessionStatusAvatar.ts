import type { SessionState } from '@/utils/sessionUtils';

export type SessionStatusAvatarState =
    | 'action-required'
    | 'unread'
    | 'thinking'
    | 'waiting'
    | 'disconnected'
    | 'idle';

export type SessionStatusAvatarPresentation = {
    state: SessionStatusAvatarState;
    ringWidth: 2 | 3;
    pulsing: boolean;
    faded: boolean;
};

/**
 * Resolve the one status signal rendered around a session's identity avatar.
 *
 * The ordering is intentional. A blocking request remains visible even if the
 * session also has unread output, and unread output remains visible while the
 * daemon is reconnecting. `active` separates a live agent waiting to continue
 * from a connected-but-idle historical session.
 */
export function resolveSessionStatusAvatar(options: {
    active: boolean;
    hasUnread: boolean;
    machineOffline?: boolean;
    state: SessionState;
}): SessionStatusAvatarPresentation {
    if (options.state === 'permission_required' || options.state === 'input_required') {
        return {
            state: 'action-required',
            ringWidth: 3,
            pulsing: true,
            faded: false,
        };
    }

    if (options.hasUnread) {
        return {
            state: 'unread',
            ringWidth: 3,
            pulsing: false,
            faded: false,
        };
    }

    if (options.state === 'thinking') {
        return {
            state: 'thinking',
            ringWidth: 3,
            pulsing: true,
            faded: false,
        };
    }

    if (options.machineOffline || options.state === 'disconnected') {
        return {
            state: 'disconnected',
            ringWidth: 2,
            pulsing: false,
            faded: true,
        };
    }

    if (options.active) {
        return {
            state: 'waiting',
            ringWidth: 2,
            pulsing: false,
            faded: false,
        };
    }

    return {
        state: 'idle',
        ringWidth: 2,
        pulsing: false,
        faded: false,
    };
}

/** Two readable characters for an identity whose image is unavailable. */
export function identityInitials(name: string | null | undefined, fallback: string): string {
    const words = (name?.trim() || fallback.trim())
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}
