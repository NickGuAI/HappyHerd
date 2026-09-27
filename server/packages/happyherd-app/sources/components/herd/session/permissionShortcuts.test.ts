import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default } }));

import {
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
});
