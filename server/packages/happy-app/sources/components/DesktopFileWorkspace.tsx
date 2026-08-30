import * as React from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FileIcon } from '@/components/FileIcon';
import { FileViewPanel } from '@/components/FileViewPanel';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import {
    defaultDesktopFileWorkspaceWidth,
    DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
    resolveDesktopFileWorkspaceWidth,
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
    dirtyPaths: ReadonlySet<string>;
    pickerOpen: boolean;
    compact?: boolean;
    picker: React.ReactNode;
    onSelect: (path: string) => void;
    onRequestClose: (path: string) => void;
    onOpenPicker: () => void;
    onDirtyChange: (path: string, dirty: boolean) => void;
};

export const DesktopFileWorkspace = React.memo(function DesktopFileWorkspace({
    sessionId,
    paths,
    activePath,
    dirtyPaths,
    pickerOpen,
    compact = false,
    picker,
    onSelect,
    onRequestClose,
    onOpenPicker,
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
                            if (pickerOpen && activePath) {
                                onSelect(activePath);
                            } else if (activePath) {
                                onRequestClose(activePath);
                            }
                        }}
                        accessibilityLabel={t('common.back')}
                        hitSlop={8}
                        style={({ pressed, hovered }: any) => [
                            styles.compactBack,
                            (pressed || hovered) && styles.tabCloseHovered,
                        ]}
                    >
                        <Octicons name="chevron-left" size={18} color={theme.colors.text} />
                    </Pressable>
                    {!pickerOpen && activePath ? <FileIcon fileName={fileName(activePath)} size={16} /> : null}
                    <Text numberOfLines={1} style={styles.compactTitle}>
                        {pickerOpen ? t('files.allFiles') : activePath ? fileName(activePath) : ''}
                    </Text>
                    <View style={styles.activeHeaderSlot} pointerEvents="box-none">
                        {!pickerOpen && activePath ? headerSlots[activePath] : null}
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
                        const name = fileName(path);
                        const active = !pickerOpen && path === activePath;
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
                <Pressable
                    onPress={onOpenPicker}
                    accessibilityLabel={t('files.openExistingFile')}
                    style={({ pressed, hovered }: any) => [
                        styles.addButton,
                        pickerOpen && styles.addButtonActive,
                        (pressed || hovered) && styles.addButtonHovered,
                    ]}
                >
                    <Octicons name="plus" size={15} color={theme.colors.textSecondary} />
                </Pressable>
                <View style={styles.activeHeaderSlot} pointerEvents="box-none">
                    {!pickerOpen && activePath ? headerSlots[activePath] : null}
                </View>
            </View>}

            <View style={styles.body}>
                <View
                    pointerEvents={pickerOpen ? 'auto' : 'none'}
                    style={[styles.layer, !pickerOpen && styles.hiddenLayer]}
                >
                    {picker}
                </View>
                {paths.map((path) => {
                    const active = !pickerOpen && path === activePath;
                    return (
                        <MountedFilePanel
                            key={path}
                            sessionId={sessionId}
                            path={path}
                            active={active}
                            onHeaderSlotChange={handleHeaderSlotChange}
                            onDirtyChange={onDirtyChange}
                        />
                    );
                })}
            </View>
        </View>
    );
});

const MountedFilePanel = React.memo(function MountedFilePanel({
    sessionId,
    path,
    active,
    onHeaderSlotChange,
    onDirtyChange,
}: {
    sessionId: string;
    path: string;
    active: boolean;
    onHeaderSlotChange: (path: string, slot: React.ReactNode) => void;
    onDirtyChange: (path: string, dirty: boolean) => void;
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
            testID={`desktop-file-panel:${path}`}
        >
            <FileViewPanel
                sessionId={sessionId}
                filePath={path}
                active={active}
                onHeaderRightSlotChange={publishHeaderSlot}
                onDirtyChange={publishDirty}
            />
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

    return (
        <View
            {...panResponder.panHandlers}
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
    } as any,
    dividerGrip: {
        width: 2,
        height: 48,
        borderRadius: 1,
        opacity: 0.7,
    },
}));
