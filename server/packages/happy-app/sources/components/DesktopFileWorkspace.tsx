import * as React from 'react';
import { LayoutChangeEvent, PanResponder, Platform, Pressable, ScrollView, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FileIcon } from '@/components/FileIcon';
import { FileViewPanel, MachineFileViewPanel } from '@/components/FileViewPanel';
import { WorkspaceFeedbackComposer } from '@/components/WorkspaceFeedbackComposer';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import {
    desktopFilePath,
    defaultDesktopFileWorkspaceWidth,
    DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
    resolveDesktopFileWorkspaceWidth,
    type DesktopFileReference,
} from './desktopFileWorkspaceModel';

export const DesktopFileWorkspaceSplit = React.memo(function DesktopFileWorkspaceSplit({
    workspaceVisible,
    workspaceFullscreen,
    workspace,
    fallback,
    children,
}: {
    workspaceVisible: boolean;
    workspaceFullscreen: boolean;
    workspace: React.ReactNode;
    fallback: React.ReactNode;
    children: React.ReactNode;
}) {
    const [availableWidth, setAvailableWidth] = React.useState(1200);
    const [workspaceWidth, setWorkspaceWidth] = React.useState(
        () => defaultDesktopFileWorkspaceWidth(1200),
    );

    const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
        const nextAvailableWidth = event.nativeEvent.layout.width;
        setAvailableWidth(nextAvailableWidth);
        setWorkspaceWidth((current) => (
            resolveDesktopFileWorkspaceWidth(current, nextAvailableWidth)
        ));
    }, []);
    const handleWidthChange = React.useCallback((requestedWidth: number) => {
        setWorkspaceWidth(resolveDesktopFileWorkspaceWidth(requestedWidth, availableWidth));
    }, [availableWidth]);

    return (
        <View style={styles.split} onLayout={handleLayout} testID="desktop-file-workspace-split">
            <View
                pointerEvents={workspaceFullscreen ? 'none' : 'auto'}
                style={styles.chatPane}
            >
                {children}
            </View>
            {workspaceVisible ? (
                <DesktopFileWorkspaceDivider
                    width={workspaceWidth}
                    onWidthChange={handleWidthChange}
                />
            ) : null}
            <View
                pointerEvents={workspaceVisible || workspaceFullscreen ? 'auto' : 'none'}
                style={workspaceFullscreen
                    ? styles.fullscreenWorkspace
                    : workspaceVisible
                        ? { width: workspaceWidth, alignSelf: 'stretch' }
                        : styles.hiddenWorkspace}
                testID="desktop-file-workspace-host"
            >
                {workspace}
            </View>
            {workspaceVisible || workspaceFullscreen ? null : fallback}
        </View>
    );
});

type DesktopFileWorkspaceProps = {
    sessionId: string;
    paths: string[];
    activePath: string | null;
    references?: Record<string, DesktopFileReference>;
    dirtyPaths: ReadonlySet<string>;
    machinePickerOpen?: boolean;
    compact?: boolean;
    machinePicker?: React.ReactNode;
    onSelect: (path: string) => void;
    onRequestClose: (path: string) => void;
    onFileDeleted: (path: string) => void;
    onOpenMachinePicker?: () => void;
    onClosePicker: () => void;
    onDirtyChange: (path: string, dirty: boolean) => void;
};

export const DesktopFileWorkspace = React.memo(function DesktopFileWorkspace({
    sessionId,
    paths,
    activePath,
    references = {},
    dirtyPaths,
    machinePickerOpen = false,
    compact = false,
    machinePicker,
    onSelect,
    onRequestClose,
    onFileDeleted,
    onOpenMachinePicker,
    onClosePicker,
    onDirtyChange,
}: DesktopFileWorkspaceProps) {
    const { theme } = useUnistyles();
    const [headerSlots, setHeaderSlots] = React.useState<Record<string, React.ReactNode>>({});

    React.useEffect(() => {
        setHeaderSlots((current) => {
            const retained = Object.entries(current).filter(([path]) => paths.includes(path));
            return retained.length === Object.keys(current).length
                ? current
                : Object.fromEntries(retained);
        });
    }, [paths]);

    const handleHeaderSlotChange = React.useCallback((path: string, slot: React.ReactNode) => {
        setHeaderSlots((current) => {
            if (current[path] === slot) return current;
            if (slot === null) {
                const { [path]: _removed, ...rest } = current;
                return rest;
            }
            return { ...current, [path]: slot };
        });
    }, []);

    return (
        <View style={styles.container} testID="desktop-file-workspace">
            {compact ? (
                <View style={styles.compactHeader} testID="desktop-file-workspace-fullscreen-header">
                    <Pressable
                        onPress={() => {
                            if (machinePickerOpen) {
                                onClosePicker();
                            } else if (activePath) {
                                onRequestClose(activePath);
                            }
                        }}
                        accessibilityLabel={t('common.back')}
                        testID="desktop-file-workspace-picker-close"
                        hitSlop={8}
                        style={({ pressed, hovered }: any) => [
                            styles.compactBack,
                            (pressed || hovered) && styles.tabCloseHovered,
                        ]}
                    >
                        <Octicons name="chevron-left" size={18} color={theme.colors.text} />
                    </Pressable>
                    {!machinePickerOpen && activePath ? <FileIcon fileName={fileName(desktopFilePath(activePath))} size={16} /> : null}
                    <Text numberOfLines={1} style={styles.compactTitle}>
                        {machinePickerOpen ? t('workspace.title') : activePath ? fileName(desktopFilePath(activePath)) : ''}
                    </Text>
                    <View style={styles.activeHeaderSlot} pointerEvents="box-none">
                        {!machinePickerOpen && activePath ? headerSlots[activePath] : null}
                    </View>
                </View>
            ) : <View style={styles.tabBar}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabRow}
                    style={styles.tabScroller}
                >
                    {paths.map((path) => {
                        const name = fileName(desktopFilePath(path));
                        const active = !machinePickerOpen && path === activePath;
                        return (
                            <Pressable
                                key={path}
                                onPress={() => onSelect(path)}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: active }}
                                accessibilityLabel={t('files.openFileTab', { name })}
                                style={({ pressed, hovered }: any) => [
                                    styles.tab,
                                    active && styles.tabActive,
                                    (pressed || hovered) && !active && styles.tabHovered,
                                ]}
                            >
                                <FileIcon fileName={name} size={15} />
                                <Text numberOfLines={1} style={[styles.tabText, active && styles.tabTextActive]}>
                                    {name}
                                </Text>
                                {dirtyPaths.has(path) ? <View style={styles.dirtyDot} /> : null}
                                <Pressable
                                    onPress={(event) => {
                                        event.stopPropagation?.();
                                        onRequestClose(path);
                                    }}
                                    accessibilityLabel={t('files.closeFileTab', { name })}
                                    hitSlop={6}
                                    style={({ pressed, hovered }: any) => [
                                        styles.tabClose,
                                        (pressed || hovered) && styles.tabCloseHovered,
                                    ]}
                                >
                                    <Octicons name="x" size={12} color={theme.colors.textSecondary} />
                                </Pressable>
                            </Pressable>
                        );
                    })}
                </ScrollView>
                {machinePickerOpen ? (
                    <Pressable
                        onPress={onClosePicker}
                        accessibilityLabel={t('common.back')}
                        testID="desktop-file-workspace-picker-close"
                        style={({ pressed, hovered }: any) => [
                            styles.addButton,
                            (pressed || hovered) && styles.addButtonHovered,
                        ]}
                    >
                        <Octicons name="chevron-left" size={15} color={theme.colors.textSecondary} />
                    </Pressable>
                ) : null}
                <Pressable
                    onPress={onOpenMachinePicker}
                    accessibilityLabel={t('workspace.title')}
                    style={({ pressed, hovered }: any) => [
                        styles.addButton,
                        machinePickerOpen && styles.addButtonActive,
                        (pressed || hovered) && styles.addButtonHovered,
                    ]}
                >
                    <Octicons name="device-desktop" size={15} color={theme.colors.textSecondary} />
                </Pressable>
                <View style={styles.activeHeaderSlot} pointerEvents="box-none">
                    {!machinePickerOpen && activePath ? headerSlots[activePath] : null}
                </View>
            </View>}

            <View style={styles.body}>
                <View
                    pointerEvents={machinePickerOpen ? 'auto' : 'none'}
                    style={[styles.layer, !machinePickerOpen && styles.hiddenLayer]}
                >
                    {machinePicker}
                </View>
                {paths.map((path) => {
                    const active = !machinePickerOpen && path === activePath;
                    return (
                        <MountedFilePanel
                            key={path}
                            sessionId={sessionId}
                            path={path}
                            reference={references[path]}
                            active={active}
                            onHeaderSlotChange={handleHeaderSlotChange}
                            onDirtyChange={onDirtyChange}
                            onDeleted={onFileDeleted}
                            headerVariant={compact ? 'standard' : 'desktop-workspace'}
                        />
                    );
                })}
            </View>
            {!machinePickerOpen && activePath && references[activePath] ? (
                <WorkspaceFeedbackComposer
                    key={activePath}
                    originSessionId={sessionId}
                    machineId={references[activePath].machineId}
                    absolutePath={desktopFilePath(activePath)}
                    line={references[activePath].line}
                    column={references[activePath].column}
                    onSent={() => undefined}
                />
            ) : null}
        </View>
    );
});

const MountedFilePanel = React.memo(function MountedFilePanel({
    sessionId,
    path,
    reference,
    active,
    onHeaderSlotChange,
    onDirtyChange,
    onDeleted,
    headerVariant,
}: {
    sessionId: string;
    path: string;
    reference: DesktopFileReference | undefined;
    active: boolean;
    onHeaderSlotChange: (path: string, slot: React.ReactNode) => void;
    onDirtyChange: (path: string, dirty: boolean) => void;
    onDeleted: (path: string) => void;
    headerVariant: 'standard' | 'desktop-workspace';
}) {
    const publishHeaderSlot = React.useCallback(
        (slot: React.ReactNode) => onHeaderSlotChange(path, slot),
        [onHeaderSlotChange, path],
    );
    const publishDirty = React.useCallback(
        (dirty: boolean) => onDirtyChange(path, dirty),
        [onDirtyChange, path],
    );

    return (
        <View
            pointerEvents={active ? 'auto' : 'none'}
            style={[styles.layer, !active && styles.hiddenLayer]}
            testID={`desktop-file-panel:${desktopFilePath(path)}`}
        >
            {reference?.source === 'machine' ? (
                <MachineFileViewPanel
                    machineId={reference.machineId}
                    originSessionId={sessionId}
                    filePath={desktopFilePath(path)}
                    active={active}
                    headerVariant={headerVariant}
                    onHeaderRightSlotChange={publishHeaderSlot}
                    onDirtyChange={publishDirty}
                    onDeleted={() => onDeleted(path)}
                    requestedLine={reference.line}
                    requestedColumn={reference.column}
                />
            ) : (
                <FileViewPanel
                    sessionId={sessionId}
                    filePath={desktopFilePath(path)}
                    active={active}
                    headerVariant={headerVariant}
                    onHeaderRightSlotChange={publishHeaderSlot}
                    onDirtyChange={publishDirty}
                    onDeleted={() => onDeleted(path)}
                    requestedLine={reference?.line}
                    requestedColumn={reference?.column}
                />
            )}
        </View>
    );
});

export const DesktopFileWorkspaceDivider = React.memo(function DesktopFileWorkspaceDivider({
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

    const panResponder = React.useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
            dragStartWidthRef.current = widthRef.current;
            setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
            onWidthChange(dragStartWidthRef.current - gesture.dx);
        },
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
    }), [onWidthChange]);

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
            {...(Platform.OS === 'web' ? webPointerHandlers : panResponder.panHandlers)}
            accessibilityRole="adjustable"
            accessibilityLabel={t('files.resizeWorkspace')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
                onWidthChange(width + (event.nativeEvent.actionName === 'increment' ? 40 : -40));
            }}
            style={[
                styles.divider,
                { backgroundColor: theme.colors.divider },
                dragging && { backgroundColor: theme.colors.textLink },
            ]}
            testID="desktop-file-workspace-divider"
        >
            <View style={[styles.dividerGrip, { backgroundColor: dragging ? theme.colors.textLink : theme.colors.textSecondary }]} />
        </View>
    );
});

function fileName(path: string): string {
    return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

const styles = StyleSheet.create((theme) => ({
    split: {
        flex: 1,
        flexDirection: 'row',
        minWidth: 0,
    },
    chatPane: {
        flex: 1,
        minWidth: 0,
    },
    hiddenWorkspace: {
        display: 'none',
    },
    fullscreenWorkspace: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1500,
    },
    container: {
        flex: 1,
        minWidth: 0,
        backgroundColor: theme.colors.surface,
    },
    tabBar: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.groupped.background,
    },
    compactHeader: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.groupped.background,
    },
    compactBack: {
        width: 30,
        height: 30,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    compactTitle: {
        minWidth: 0,
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    tabScroller: {
        flexGrow: 0,
        flexShrink: 1,
        maxWidth: '100%',
    },
    tabRow: {
        alignItems: 'center',
        gap: 5,
        paddingVertical: 7,
    },
    tab: {
        height: 32,
        maxWidth: 190,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 9,
        paddingRight: 5,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
    },
    tabActive: {
        backgroundColor: theme.colors.surfaceSelected,
        borderColor: theme.colors.divider,
    },
    tabHovered: {
        backgroundColor: theme.colors.surface,
    },
    tabText: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    tabTextActive: {
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    dirtyDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.textLink,
    },
    tabClose: {
        width: 22,
        height: 22,
        borderRadius: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabCloseHovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    addButton: {
        width: 30,
        height: 30,
        flexShrink: 0,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addButtonActive: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    addButtonHovered: {
        backgroundColor: theme.colors.surface,
    },
    activeHeaderSlot: {
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    body: {
        flex: 1,
        minHeight: 0,
        position: 'relative',
    },
    layer: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.surface,
    },
    hiddenLayer: {
        display: 'none',
    },
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
}));
