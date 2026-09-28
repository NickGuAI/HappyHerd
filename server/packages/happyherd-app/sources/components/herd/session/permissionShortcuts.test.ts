import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default } }));

import {
    clipShortcutRect,
    shortcutSamplePoints,
    pickPermissionShortcutTarget,
    resolvePermissionShortcutIndex,
    type PermissionShortcutTarget,
} from './permissionShortcuts';

describe('permission number keys', () => {
    it('maps 1..n to choices and ignores everything else', () => {
        expect(resolvePermissionShortcutIndex({ key: '1' }, 3)).toBe(0);
        expect(resolvePermissionShortcutIndex({ key: '3' }, 3)).toBe(2);
        expect(resolvePermissionShortcutIndex({ key: '4' }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '0' }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: 'y' }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '1', metaKey: true }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '1', ctrlKey: true }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '1', altKey: true }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '1', shiftKey: true }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '1', repeat: true }, 3)).toBeNull();
        expect(resolvePermissionShortcutIndex({ key: '1', isComposing: true }, 3)).toBeNull();
    });

    it('answers only the oldest visible pending card', () => {
        const target = (id: string, visible: boolean, choices = 2): PermissionShortcutTarget & { visible: boolean } => ({
            id,
            visible,
            getChoices: () => Array.from({ length: choices }, () => () => {}),
            getNode: () => id,
        });
        const hidden = target('background-session', false);
        const first = target('first-visible', true);
        const second = target('second-visible', true);
        const isVisible = (node: unknown) => [first, second].some((candidate) => candidate.visible && candidate.id === node);
        expect(pickPermissionShortcutTarget([hidden, first, second], isVisible)?.id).toBe('first-visible');
        expect(pickPermissionShortcutTarget([hidden], isVisible)).toBeNull();
        expect(pickPermissionShortcutTarget([target('empty', true, 0), second], () => true)?.id).toBe('second-visible');
    });

    it('treats a card clipped away by a scrolling ancestor as hidden', () => {
        const viewport = { left: 0, top: 0, right: 390, bottom: 844 };
        const chatList = { left: -Infinity, top: 64, right: Infinity, bottom: 556 };
        // Inside the window but past the chat list's bottom edge.
        expect(clipShortcutRect({ left: 16, top: 560, right: 374, bottom: 700 }, [viewport, chatList])).toBeNull();
        // Partly scrolled into the list: only the part inside it remains.
        expect(clipShortcutRect({ left: 16, top: 500, right: 374, bottom: 640 }, [viewport, chatList]))
            .toEqual({ left: 16, top: 500, right: 374, bottom: 556 });
        expect(clipShortcutRect({ left: 16, top: -200, right: 374, bottom: -10 }, [viewport])).toBeNull();
    });

    it('samples points across the visible part, not only its centre', () => {
        const points = shortcutSamplePoints({ left: 0, top: 100, right: 200, bottom: 160 });
        expect(points).toHaveLength(9);
        expect(points).toContainEqual([4, 104]);
        expect(points).toContainEqual([100, 130]);
        expect(points).toContainEqual([196, 156]);
        // A sliver keeps its points inside it.
        for (const [, y] of shortcutSamplePoints({ left: 0, top: 10, right: 200, bottom: 12 })) {
            expect(y).toBeGreaterThanOrEqual(10);
            expect(y).toBeLessThanOrEqual(12);
        }
    });
});
