import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { SessionActionsAnchor } from '@/components/SessionActionsPopover';
import { t } from '@/text';
import { herdWebClasses } from '../motion';
import { useHerdSelectionGlide } from './selectionGlide';
import { useHerdPhoneLayout } from '../mobile/useHerdPhone';

/** True in a touch-only browser, where rows have no hover ⋯. */
export function isTouchOnlyWeb(): boolean {
    return Platform.OS === 'web'
        && typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(hover: none)').matches;
}

/**
 * Row props for touch-only browsers. iOS Safari sends no context menu on a
 * long press, so the row reads the long press itself and opens the same
 * actions, as the native app does. The browser then clicks where the finger
 * lifts, which is now the sheet's backdrop; cancelling that touch's release
 * (its events still target the row) prevents the click.
 */
export function useHerdRowLongPress(open: (event: any) => void): Record<string, unknown> {
    const pressedRef = React.useRef(false);
    const onLongPress = React.useCallback((event: any) => {
        pressedRef.current = true;
        open(event);
    }, [open]);
    const onTouchEnd = React.useCallback((event: any) => {
        if (!pressedRef.current) return;
        pressedRef.current = false;
        event.preventDefault?.();
    }, []);
    return isTouchOnlyWeb() ? { onLongPress, onTouchEnd } : {};
}

/** Web data attributes and host class every session row carries. */
export function herdRowDataSet(sessionId: string): object {
    // React Native Web renders dataSet as data-* attributes; the glide finds rows by it.
    return { dataSet: { herdRow: sessionId } };
}

/**
 * The shared selection ring behind a selected session row. On web it glides
 * in from the previously selected row.
 */
export function HerdRowSelection({ sessionId, selected, radius }: { sessionId: string; selected: boolean; radius?: number }) {
    const highlightRef = React.useRef<View | null>(null);
    useHerdSelectionGlide(sessionId, selected, highlightRef);
    if (!selected) return null;
    return (
        <View
            ref={highlightRef}
            pointerEvents="none"
            style={[styles.selection, radius !== undefined && { borderRadius: radius }]}
        />
    );
}

/**
 * The row's ⋯ button. With a pointer (web) it appears while the row is hovered
 * or keyboard focused and opens the same actions menu as a right-click,
 * anchored to itself. Touch screens have no hover, so on touch-only web and on
 * native phones it stays visible in its own column at the row's end, as the
 * phone mock draws it; native phones open the row's long-press actions.
 */
export function HerdRowMoreButton({ open, onOpen, onNativePress, top = 8 }: {
    open: boolean;
    onOpen: (anchor: SessionActionsAnchor) => void;
    /** Native phones: the row's long-press actions. */
    onNativePress?: () => void;
    top?: number;
}) {
    const { theme } = useUnistyles();
    const ref = React.useRef<View | null>(null);
    const phoneLayout = useHerdPhoneLayout();
    const web = Platform.OS === 'web';
    const touch = web ? isTouchOnlyWeb() : phoneLayout && !!onNativePress;
    const handlePress = React.useCallback((event: any) => {
        event?.stopPropagation?.();
        if (!web) {
            onNativePress?.();
            return;
        }
        ref.current?.measureInWindow((x, y, width, height) => onOpen({ type: 'rect', x, y, width, height }));
    }, [onNativePress, onOpen, web]);
    if (!web && !touch) return null;
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={t('sessionInfo.quickActions')}
            aria-expanded={open}
            onPress={handlePress}
            hitSlop={touch ? { top: 8, bottom: 8, left: 8, right: 8 } : undefined}
            testID="session-row-more"
            {...({ dataSet: { open: open ? 'true' : 'false', touch: touch ? 'true' : 'false' } } as any)}
            style={({ hovered }: any) => touch
                ? styles.moreTouch
                : [styles.more, { top }, hovered && styles.moreHovered]}
        >
            <Ionicons name="ellipsis-horizontal" size={touch ? 17 : 15} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    selection: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: theme.kilv.radius,
        borderWidth: Platform.OS === 'web' ? 0 : 1,
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
        _web: {
            boxShadow: theme.colors.selection.ring,
            _classNames: herdWebClasses('herd-glide'),
        },
    },
    more: {
        position: 'absolute',
        right: 8,
        width: 26,
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-row-reveal') },
    },
    moreHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    // Touch: the mock's trailing column, always shown, beside the row's text.
    moreTouch: {
        width: 28,
        height: 28,
        flexShrink: 0,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
    },
}));
