import { describe, expect, it } from 'vitest';

import { identityInitials, resolveSessionStatusAvatar } from './sessionStatusAvatar';

describe('resolveSessionStatusAvatar', () => {
    it('uses the locked precedence for blocking requests, unread output, and work', () => {
        expect(resolveSessionStatusAvatar({
            active: true,
            hasUnread: true,
            machineOffline: true,
            state: 'input_required',
        })).toEqual({ state: 'action-required', ringWidth: 3, pulsing: true, faded: false });

        expect(resolveSessionStatusAvatar({
            active: true,
            hasUnread: true,
            machineOffline: true,
            state: 'thinking',
        })).toEqual({ state: 'unread', ringWidth: 3, pulsing: false, faded: false });

        expect(resolveSessionStatusAvatar({
            active: true,
            hasUnread: false,
            state: 'thinking',
        })).toEqual({ state: 'thinking', ringWidth: 3, pulsing: true, faded: false });
    });

    it('distinguishes waiting, disconnected, and connected idle sessions', () => {
        expect(resolveSessionStatusAvatar({
            active: true,
            hasUnread: false,
            state: 'waiting',
        })).toEqual({ state: 'waiting', ringWidth: 2, pulsing: false, faded: false });

        expect(resolveSessionStatusAvatar({
            active: false,
            hasUnread: false,
            state: 'disconnected',
        })).toEqual({ state: 'disconnected', ringWidth: 2, pulsing: false, faded: true });

        expect(resolveSessionStatusAvatar({
            active: false,
            hasUnread: false,
            state: 'waiting',
        })).toEqual({ state: 'idle', ringWidth: 2, pulsing: false, faded: false });
    });

    it('treats a dead owning daemon as disconnected', () => {
        expect(resolveSessionStatusAvatar({
            active: true,
            hasUnread: false,
            machineOffline: true,
            state: 'waiting',
        }).state).toBe('disconnected');
    });
});

describe('identityInitials', () => {
    it('uses the Commander name and falls back to the stable ID', () => {
        expect(identityInitials('Athena Prime', 'athena')).toBe('AP');
        expect(identityInitials('Athena', 'athena')).toBe('AT');
        expect(identityInitials(null, 'gaia')).toBe('GA');
        expect(identityInitials(' ', '')).toBe('?');
    });
});
