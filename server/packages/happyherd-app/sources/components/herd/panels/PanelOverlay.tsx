import * as React from 'react';
import { Platform, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { herdWebClasses } from '@/components/herd/motion';

/**
 * Below 1,100 px on desktop Web the right panel and the Workspace slide in
 * over the chat as a sheet (UI overhaul). The sheet host itself stays a plain
 * view in `DesktopFileWorkspaceSplit`, so closing only hides it and every
 * panel, editor and draft stays mounted. This module holds the scrim and the
 * Escape handling that the host shares.
 */

/**
 * Dimmed layer over the chat; pressing it closes the sheet. Like a popover
 * backdrop it stays out of the accessibility tree: the sheet's own close
 * button and Escape are the accessible ways out.
 */
export function HerdPanelScrim(props: {
    onPress: () => void;
    testID?: string;
}) {
    return (
        <Pressable
            accessible={false}
            onPress={props.onPress}
            style={styles.scrim}
            testID={props.testID}
        />
    );
}

function isEditableElement(element: Element | null): boolean {
    if (!element) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return true;
    }
    return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Web: Escape closes an open sheet unless something inside handled it first
 * or focus is in an editable field (the composer uses Escape to stop a turn
 * and to dismiss suggestions).
 */
export function useHerdOverlayEscape(open: boolean, onClose: () => void): void {
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    React.useEffect(() => {
        if (!open || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
            if (isEditableElement(document.activeElement)) return;
            if (document.querySelector('[aria-modal="true"]')) return;
            event.preventDefault();
            onCloseRef.current();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open]);
}

/** Width of a sheet: generous, but always leaving a strip of scrim to close it by. */
export function resolveHerdSheetWidth(availableWidth: number, preferredWidth: number): number {
    const leftover = 56;
    return Math.max(0, Math.min(preferredWidth, availableWidth - leftover));
}

const styles = StyleSheet.create((theme) => ({
    scrim: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1400,
        backgroundColor: theme.colors.kilv.scrim,
        _web: {
            cursor: 'default',
            _classNames: herdWebClasses('herd-fade'),
        },
    },
}));
