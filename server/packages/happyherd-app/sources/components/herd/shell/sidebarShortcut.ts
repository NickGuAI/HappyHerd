import * as React from 'react';
import { Platform } from 'react-native';
import { useNativeShortcuts } from '@/keyboard/nativeShortcuts';

import {
    formatShortcutChord,
    getPreferredShortcutModifier,
    matchesShortcutChord,
    type ShortcutChord,
    type ShortcutModifier,
} from '@/keyboard/shortcuts';
import { storage } from '@/sync/storage';

/** ⌥⌘B on macOS, Ctrl+Alt+B elsewhere: collapse or expand the left panel. */
export const HERD_SIDEBAR_TOGGLE_SHORTCUT: ShortcutChord = {
    key: 'b',
    code: 'KeyB',
    keyLabel: 'B',
    altKey: true,
};

export function preferredShortcutModifier(): ShortcutModifier {
    if (Platform.OS === 'ios') return 'meta';
    return getPreferredShortcutModifier(typeof navigator === 'undefined' ? undefined : navigator);
}

export function formatSidebarToggleShortcut(modifier: ShortcutModifier = preferredShortcutModifier()): string {
    return formatShortcutChord(modifier, HERD_SIDEBAR_TOGGLE_SHORTCUT);
}

/** Flips the persisted desktop collapse setting, the one state both controls share. */
export function toggleNavigationSidebarCollapsed(): void {
    const state = storage.getState();
    state.applyLocalSettings({
        navigationSidebarCollapsed: !state.localSettings.navigationSidebarCollapsed,
    });
}

/** Registers the collapse chord for as long as the desktop shell is mounted. */
export function useSidebarToggleShortcut(enabled: boolean): void {
    useNativeShortcuts(enabled ? [{ id: 'sidebar:toggle', key: 'b', meta: true, alt: true }] : [], toggleNavigationSidebarCollapsed);
    React.useEffect(() => {
        if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') {
            return;
        }
        const modifier = preferredShortcutModifier();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!matchesShortcutChord(event, modifier, HERD_SIDEBAR_TOGGLE_SHORTCUT)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            toggleNavigationSidebarCollapsed();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [enabled]);
}
