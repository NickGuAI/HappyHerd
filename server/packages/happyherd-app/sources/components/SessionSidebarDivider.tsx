import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH } from './desktopFileWorkspaceModel';
import { HerdPanelGrip } from './herd/panels/PanelGrip';
import { t } from '@/text';

export const SessionSidebarDivider = React.memo(function SessionSidebarDivider({
    width,
    onWidthChange,
}: {
    width: number;
    onWidthChange: (width: number) => void;
}) {
    const widthRef = React.useRef(width);
    const dragStartWidthRef = React.useRef(width);
    const dragStartClientXRef = React.useRef(0);
    const activePointerIdRef = React.useRef<number | null>(null);
    const [dragging, setDragging] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
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
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            accessibilityRole="adjustable"
            accessibilityLabel={t('sideChat.resizePanel')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
                onWidthChange(width + (event.nativeEvent.actionName === 'increment' ? 40 : -40));
            }}
            style={styles.divider}
            testID="session-sidebar-divider"
        >
            <HerdPanelGrip active={hovered || dragging} />
        </View>
    );
});

// The strip keeps its hit area; the grip straddles the panel's border
// (mock `.rpanel-grip`).
const styles = StyleSheet.create({
    divider: {
        width: DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
        alignSelf: 'stretch',
        backgroundColor: 'transparent',
        zIndex: 5,
        cursor: 'col-resize',
        userSelect: 'none',
        touchAction: 'none',
    } as any,
});
