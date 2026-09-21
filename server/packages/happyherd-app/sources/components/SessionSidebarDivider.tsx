import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH } from './desktopFileWorkspaceModel';
import { t } from '@/text';

export const SessionSidebarDivider = React.memo(function SessionSidebarDivider({
    width,
    onWidthChange,
}: {
    width: number;
    onWidthChange: (width: number) => void;
}) {
    const { theme } = useUnistyles();
    const widthRef = React.useRef(width);
    const dragStartWidthRef = React.useRef(width);
    const dragStartClientXRef = React.useRef(0);
    const activePointerIdRef = React.useRef<number | null>(null);
    const [dragging, setDragging] = React.useState(false);
    widthRef.current = width;

    const webPointerHandlers = React.useMemo(() => ({
        onPointerDown: (event: any) => {
            const pointerEvent = event.nativeEvent ?? event;
            if (pointerEvent.button !== undefined && pointerEvent.button !== 0) return;
            activePointerIdRef.current = pointerEvent.pointerId;
            dragStartClientXRef.current = pointerEvent.clientX;
            dragStartWidthRef.current = widthRef.current;
            event.currentTarget?.setPointerCapture?.(pointerEvent.pointerId);
            event.preventDefault?.();
            setDragging(true);
        },
        onPointerMove: (event: any) => {
            const pointerEvent = event.nativeEvent ?? event;
            if (activePointerIdRef.current !== pointerEvent.pointerId) return;
            onWidthChange(dragStartWidthRef.current - (pointerEvent.clientX - dragStartClientXRef.current));
            event.preventDefault?.();
        },
        onPointerUp: (event: any) => {
            const pointerEvent = event.nativeEvent ?? event;
            if (activePointerIdRef.current !== pointerEvent.pointerId) return;
            event.currentTarget?.releasePointerCapture?.(pointerEvent.pointerId);
            activePointerIdRef.current = null;
            setDragging(false);
        },
        onPointerCancel: (event: any) => {
            const pointerEvent = event.nativeEvent ?? event;
            if (activePointerIdRef.current !== pointerEvent.pointerId) return;
            activePointerIdRef.current = null;
            setDragging(false);
        },
        onLostPointerCapture: (event: any) => {
            const pointerEvent = event.nativeEvent ?? event;
            if (activePointerIdRef.current !== pointerEvent.pointerId) return;
            activePointerIdRef.current = null;
            setDragging(false);
        },
    }), [onWidthChange]);

    return (
        <View
            {...webPointerHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel={t('sideChat.resizePanel')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
                onWidthChange(width + (event.nativeEvent.actionName === 'increment' ? 40 : -40));
            }}
            style={[
                styles.divider,
                { backgroundColor: theme.colors.divider },
                dragging && { backgroundColor: theme.colors.textLink },
            ]}
            testID="session-sidebar-divider"
        >
            <View
                style={[
                    styles.dividerGrip,
                    { backgroundColor: dragging ? theme.colors.textLink : theme.colors.textSecondary },
                ]}
            />
        </View>
    );
});

const styles = StyleSheet.create({
    divider: {
        width: DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'col-resize',
        userSelect: 'none',
        touchAction: 'none',
    } as any,
    dividerGrip: {
        width: 2,
        height: 48,
        borderRadius: 1,
        opacity: 0.7,
    },
});
