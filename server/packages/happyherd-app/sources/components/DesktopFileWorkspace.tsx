import * as React from 'react';
import { LayoutChangeEvent, PanResponder, Platform, Pressable, ScrollView, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FileIcon } from '@/components/FileIcon';
import { FileViewPanel, MachineFileViewPanel } from '@/components/FileViewPanel';
import { WorkspaceFeedbackComposer } from '@/components/WorkspaceFeedbackComposer';
import { LocalhostWorkspacePanel } from '@/components/LocalhostWorkspacePanel';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { HerdPanelGrip } from '@/components/herd/panels/PanelGrip';
import { HerdPanelIconButton } from '@/components/herd/panels/PanelIconButton';
import { HerdPanelScrim, useHerdOverlayEscape } from '@/components/herd/panels/PanelOverlay';
import { HerdPanelScreenHeader } from '@/components/herd/panels/PanelScreenHeader';
import {
    panelGroundImage,
    panelHairline,
    panelHoverWash,
    panelSheetShadow,
    workspaceGround,
    workspaceGroundImage,
} from '@/components/herd/panels/panelColors';
import { t } from '@/text';
import {
    desktopFilePath,
    defaultDesktopFileWorkspaceWidth,
    DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
    isDesktopLocalhostReference,
    resolveDesktopFileWorkspaceWidth,
    type DesktopWorkspaceReference,
} from './desktopFileWorkspaceModel';

/**
 * Below 1,100 px on desktop Web the Workspace and the right panel slide in
 * over the chat as a sheet instead of docking beside it (UI overhaul).
 */
export type DesktopFileWorkspaceOverlay = {
    workspaceOpen: boolean;
    panelOpen: boolean;
    workspaceWidth: number;
    panelWidth: number;
    onDismiss: () => void;
};

const NO_OVERLAY_DISMISS = () => undefined;

export const DesktopFileWorkspaceSplit = React.memo(function DesktopFileWorkspaceSplit({
    workspaceVisible,
    workspaceFullscreen,
    workspace,
    fallback,
    overlay = null,
    children,
}: {
    workspaceVisible: boolean;
    workspaceFullscreen: boolean;
    workspace: React.ReactNode;
    fallback: React.ReactNode;
    overlay?: DesktopFileWorkspaceOverlay | null;
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

    // Every slot keeps its position in both presentations, so switching
    // between docked and overlay (or opening and closing the sheet) only
    // changes styles and never remounts the chat, an editor or a panel.
    const overlayWorkspaceOpen = !!overlay && overlay.workspaceOpen;
    const overlayPanelOpen = !!overlay && !overlay.workspaceOpen && overlay.panelOpen;
    const sheetOpen = overlayWorkspaceOpen || overlayPanelOpen;
    useHerdOverlayEscape(sheetOpen, overlay?.onDismiss ?? NO_OVERLAY_DISMISS);

    const workspaceHostStyle = overlay
        ? overlayWorkspaceOpen ? [styles.sheet, { width: overlay.workspaceWidth }] : styles.hiddenWorkspace
        : workspaceFullscreen
            ? styles.fullscreenWorkspace
            : workspaceVisible
                ? { width: workspaceWidth, alignSelf: 'stretch' as const }
                : styles.hiddenWorkspace;
    const fallbackHostStyle = overlay
        ? overlayPanelOpen ? [styles.sheet, { width: overlay.panelWidth }] : styles.hiddenWorkspace
        : styles.dockedFallback;

    return (
        <View style={styles.split} onLayout={handleLayout} testID="desktop-file-workspace-split">
            <View
                pointerEvents={workspaceFullscreen && !overlay ? 'none' : 'auto'}
                style={styles.chatPane}
            >
                {children}
            </View>
            {workspaceVisible && !overlay ? (
                <DesktopFileWorkspaceDivider
                    width={workspaceWidth}
                    onWidthChange={handleWidthChange}
                />
            ) : null}
            {sheetOpen ? (
                <HerdPanelScrim
                    onPress={overlay?.onDismiss ?? NO_OVERLAY_DISMISS}
                    testID="desktop-panel-overlay-scrim"
                />
            ) : null}
            <View
                pointerEvents={workspaceVisible || workspaceFullscreen || overlayWorkspaceOpen ? 'auto' : 'none'}
                style={workspaceHostStyle}
                testID="desktop-file-workspace-host"
            >
                {workspace}
            </View>
            <View
                pointerEvents={overlay && !overlayPanelOpen ? 'none' : 'box-none'}
                style={fallbackHostStyle}
                testID="desktop-right-panel-host"
            >
                {overlay || !(workspaceVisible || workspaceFullscreen) ? fallback : null}
            </View>
        </View>
    );
});

export type RetainedDesktopFileWorkspace = {
    sessionId: string;
    paths: string[];
    references: Record<string, DesktopWorkspaceReference>;
    machinePicker?: React.ReactNode;
};

type DesktopFileWorkspaceProps = {
    sessionId: string;
    retainedWorkspaces?: RetainedDesktopFileWorkspace[];
    paths: string[];
    activePath: string | null;
    references?: Record<string, DesktopWorkspaceReference>;
    dirtyPaths: ReadonlySet<string>;
    machinePickerOpen?: boolean;
    compact?: boolean;
    machinePicker?: React.ReactNode;
    onSelect: (path: string) => void;
    onRequestClose: (path: string) => void;
    onFileDeleted: (path: string, sessionId: string) => void;
    onOpenMachinePicker?: () => void;
    onClosePicker: () => void;
    onDirtyChange: (path: string, dirty: boolean, sessionId: string) => void;
    /** Hides the Workspace without closing its tabs (the overlay sheet's close). */
    onHide?: () => void;
};

export const DesktopFileWorkspace = React.memo(function DesktopFileWorkspace({
    sessionId,
    retainedWorkspaces = [],
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
    onHide,
}: DesktopFileWorkspaceProps) {
    const { theme } = useUnistyles();
    const [headerSlots, setHeaderSlots] = React.useState<Record<string, React.ReactNode>>({});

    const mountedWorkspaces = [{ sessionId, paths, references, machinePicker }, ...retainedWorkspaces];
    const headerKey = (owner: string, path: string) => JSON.stringify([owner, path]);
    const mountedHeaderKeys = mountedWorkspaces.flatMap((workspace) => (
        workspace.paths.map((path) => headerKey(workspace.sessionId, path))
    ));
    const headerKeys = JSON.stringify(mountedHeaderKeys);
    React.useEffect(() => {
        const keys: string[] = JSON.parse(headerKeys);
        setHeaderSlots((current) => {
            const retained = Object.entries(current).filter(([key]) => keys.includes(key));
            return retained.length === Object.keys(current).length
                ? current
                : Object.fromEntries(retained);
        });
    }, [headerKeys]);

    const handleHeaderSlotChange = React.useCallback((path: string, slot: React.ReactNode, owner: string) => {
        const key = JSON.stringify([owner, path]);
        setHeaderSlots((current) => {
            if (current[key] === slot) return current;
            if (slot === null) {
                const { [key]: _removed, ...rest } = current;
                return rest;
            }
            return { ...current, [key]: slot };
        });
    }, []);

    const activeReference = activePath ? references[activePath] : undefined;
    const activeLive = isDesktopLocalhostReference(activeReference);
    const activeFilePath = activePath && !activeLive ? desktopFilePath(activePath) : null;
    const activeSlot = !machinePickerOpen && activePath ? headerSlots[headerKey(sessionId, activePath)] : null;

    return (
        <View style={styles.container} testID="desktop-file-workspace">
            {compact ? (
                <View style={styles.compactHeader} testID="desktop-file-workspace-fullscreen-header">
                    <HerdPanelScreenHeader
                        backIcon="chevron-left"
                        backLabel={t('common.back')}
                        backTestID="desktop-file-workspace-picker-close"
                        onBack={() => {
                            if (machinePickerOpen) {
                                onClosePicker();
                            } else if (activePath) {
                                onRequestClose(activePath);
                            }
                        }}
                        leading={!machinePickerOpen && activePath ? (
                            activeLive
                                ? <Octicons name="globe" size={16} color={theme.colors.status.connecting} />
                                : <FileIcon fileName={fileName(desktopFilePath(activePath))} size={16} />
                        ) : null}
                        title={machinePickerOpen
                            ? t('workspace.title')
                            : activePath
                                ? activeLive
                                    ? activeReference.url
                                    : fileName(desktopFilePath(activePath))
                                : ''}
                        subtitle={!machinePickerOpen && activeFilePath ? parentDirectory(activeFilePath) : null}
                    />
                    {activeSlot ? (
                        <View style={styles.compactActions} pointerEvents="box-none">
                            <View style={styles.activeHeaderSlot} pointerEvents="box-none">
                                {activeSlot}
                            </View>
                        </View>
                    ) : null}
                </View>
            ) : (
                <>
                    <View style={styles.tabBar}>
                        <Pressable
                            onPress={onOpenMachinePicker}
                            accessibilityLabel={t('workspace.title')}
                            style={({ hovered, pressed }: any) => [
                                styles.browseButton,
                                (hovered || pressed) && !machinePickerOpen && styles.tabHovered,
                                machinePickerOpen && styles.tabActive,
                            ]}
                        >
                            <Octicons
                                name="device-desktop"
                                size={15}
                                color={machinePickerOpen ? theme.colors.text : theme.colors.textSecondary}
                            />
                        </Pressable>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.tabRow}
                            style={styles.tabScroller}
                        >
                            {paths.map((path) => {
                                const reference = references[path];
                                const live = isDesktopLocalhostReference(reference);
                                const name = live ? reference.url : fileName(desktopFilePath(path));
                                return (
                                    <WorkspaceFileTab
                                        key={path}
                                        name={name}
                                        live={live}
                                        dirty={!live && dirtyPaths.has(path)}
                                        active={!machinePickerOpen && path === activePath}
                                        onSelect={() => onSelect(path)}
                                        onClose={() => onRequestClose(path)}
                                    />
                                );
                            })}
                        </ScrollView>
                        <View style={styles.tabBarActions}>
                            {machinePickerOpen ? (
                                <HerdPanelIconButton
                                    accessibilityLabel={t('common.back')}
                                    testID="desktop-file-workspace-picker-close"
                                    onPress={onClosePicker}
                                    renderIcon={(color) => <Octicons name="chevron-left" size={15} color={color} />}
                                />
                            ) : null}
                            {onHide ? (
                                <HerdPanelIconButton
                                    accessibilityLabel={t('files.hidePanel')}
                                    testID="desktop-file-workspace-hide"
                                    onPress={onHide}
                                    renderIcon={(color) => <Octicons name="x" size={15} color={color} />}
                                />
                            ) : null}
                        </View>
                    </View>
                    {!machinePickerOpen && activePath ? (
                        <View style={styles.fileBar} testID="desktop-file-workspace-file-bar">
                            {activeLive ? (
                                <View style={styles.liveUrl}>
                                    <Octicons name="globe" size={14} color={theme.colors.gitAddedText} />
                                    <Text numberOfLines={1} style={styles.liveUrlText}>{activeReference.url}</Text>
                                </View>
                            ) : activeFilePath ? (
                                <Text numberOfLines={1} style={styles.filePath}>
                                    <Text style={styles.filePathDirectory}>{directoryPrefix(activeFilePath)}</Text>
                                    <Text style={styles.filePathName}>{fileName(activeFilePath)}</Text>
                                </Text>
                            ) : <View style={styles.fileBarSpacer} />}
                            <View style={styles.activeHeaderSlot} pointerEvents="box-none">
                                {activeSlot}
                            </View>
                        </View>
                    ) : null}
                </>
            )}

            <View style={styles.body}>
                {mountedWorkspaces.map((workspace) => (
                    <View
                        key={workspace.sessionId}
                        pointerEvents={workspace.sessionId === sessionId ? 'auto' : 'none'}
                        style={[styles.layer, workspace.sessionId !== sessionId && styles.hiddenLayer]}
                    >
                        <View
                            pointerEvents={machinePickerOpen ? 'auto' : 'none'}
                            style={[styles.layer, !machinePickerOpen && styles.hiddenLayer]}
                        >
                            {workspace.machinePicker}
                        </View>
                        {workspace.paths.map((path) => (
                            <MountedFilePanel
                                key={path}
                                sessionId={workspace.sessionId}
                                path={path}
                                reference={workspace.references[path]}
                                active={workspace.sessionId === sessionId && !machinePickerOpen && path === activePath}
                                onHeaderSlotChange={handleHeaderSlotChange}
                                onDirtyChange={onDirtyChange}
                                onDeleted={onFileDeleted}
                                headerVariant={compact ? 'standard' : 'desktop-workspace'}
                            />
                        ))}
                    </View>
                ))}
            </View>
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
    reference: DesktopWorkspaceReference | undefined;
    active: boolean;
    onHeaderSlotChange: (path: string, slot: React.ReactNode, sessionId: string) => void;
    onDirtyChange: (path: string, dirty: boolean, sessionId: string) => void;
    onDeleted: (path: string, sessionId: string) => void;
    headerVariant: 'standard' | 'desktop-workspace';
}) {
    const publishHeaderSlot = React.useCallback(
        (slot: React.ReactNode) => onHeaderSlotChange(path, slot, sessionId),
        [onHeaderSlotChange, path, sessionId],
    );
    const publishDirty = React.useCallback(
        (dirty: boolean) => onDirtyChange(path, dirty, sessionId),
        [onDirtyChange, path, sessionId],
    );

    return (
        <View
            pointerEvents={active ? 'auto' : 'none'}
            style={[styles.layer, !active && styles.hiddenLayer]}
            testID={`desktop-file-panel:${isDesktopLocalhostReference(reference) ? reference.url : desktopFilePath(path)}`}
        >
            {isDesktopLocalhostReference(reference) ? (
                <LocalhostWorkspacePanel
                    sessionId={sessionId}
                    machineId={reference.machineId}
                    url={reference.url}
                    active={active}
                    onHeaderRightSlotChange={publishHeaderSlot}
                />
            ) : reference?.source === 'machine' ? (
                <MachineFileViewPanel
                    machineId={reference.machineId}
                    originSessionId={sessionId}
                    filePath={desktopFilePath(path)}
                    active={active}
                    headerVariant={headerVariant}
                    onHeaderRightSlotChange={publishHeaderSlot}
                    onDirtyChange={publishDirty}
                    onDeleted={() => onDeleted(path, sessionId)}
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
                    onDeleted={() => onDeleted(path, sessionId)}
                    requestedLine={reference?.line}
                    requestedColumn={reference?.column}
                />
            )}
            {reference && !isDesktopLocalhostReference(reference) ? (
                <WorkspaceFeedbackComposer
                    originSessionId={sessionId}
                    machineId={reference.machineId}
                    absolutePath={desktopFilePath(path)}
                    line={reference.line}
                    column={reference.column}
                    onSent={() => undefined}
                />
            ) : null}
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
    const widthRef = React.useRef(width);
    const dragStartWidthRef = React.useRef(width);
    const dragStartClientXRef = React.useRef(0);
    const activePointerIdRef = React.useRef<number | null>(null);
    const [dragging, setDragging] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
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
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            accessibilityRole="adjustable"
            accessibilityLabel={t('files.resizeWorkspace')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
                onWidthChange(width + (event.nativeEvent.actionName === 'increment' ? 40 : -40));
            }}
            style={styles.divider}
            testID="desktop-file-workspace-divider"
        >
            {/* The Workspace pane's left border (mock `.ws-pane`), drawn by the divider. */}
            <View pointerEvents="none" style={styles.dividerLine} />
            <HerdPanelGrip active={hovered || dragging} lineInside />
        </View>
    );
});

function fileName(path: string): string {
    return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

/** Everything up to and including the last separator (mock `.ws-bar .path`). */
function directoryPrefix(path: string): string {
    const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return separator < 0 ? '' : path.slice(0, separator + 1);
}

function parentDirectory(path: string): string | null {
    const prefix = directoryPrefix(path);
    return prefix.length > 1 ? prefix.slice(0, -1) : prefix || null;
}

/** One open file or live page (mock `.ws-tab`): a folder tab that sits on the strip's hairline. */
const WorkspaceFileTab = React.memo(function WorkspaceFileTab({
    name,
    live,
    dirty,
    active,
    onSelect,
    onClose,
}: {
    name: string;
    live: boolean;
    dirty: boolean;
    active: boolean;
    onSelect: () => void;
    onClose: () => void;
}) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    return (
        <Pressable
            onPress={onSelect}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityLabel={t('files.openFileTab', { name })}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            style={[styles.tab, active && styles.tabActive]}
        >
            {live
                ? <Octicons name="globe" size={14} color={theme.colors.status.connecting} />
                : <FileIcon fileName={name} size={15} />}
            <Text
                numberOfLines={1}
                style={[styles.tabText, (active || hovered) && styles.tabTextActive, active && styles.tabTextSelected]}
            >
                {name}
            </Text>
            {dirty ? <View style={styles.dirtyDot} /> : null}
            <Pressable
                onPress={(event) => {
                    event.stopPropagation?.();
                    onClose();
                }}
                accessibilityLabel={t('files.closeFileTab', { name })}
                hitSlop={6}
                style={({ pressed, hovered: closeHovered }: any) => [
                    styles.tabClose,
                    (active || hovered) && styles.tabCloseShown,
                    (pressed || closeHovered) && styles.tabCloseHovered,
                ]}
            >
                <Octicons name="x" size={12} color={theme.colors.textSecondary} />
            </Pressable>
        </Pressable>
    );
});

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
    dockedFallback: {
        flexDirection: 'row',
        alignSelf: 'stretch',
        minWidth: 0,
    },
    // Slide-in sheet over the chat (mock `.panel-overlay`, `herd-slide-right`).
    sheet: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 1500,
        flexDirection: 'row',
        backgroundColor: theme.colors.groupped.background,
        borderLeftWidth: 1,
        borderLeftColor: panelHairline(theme),
        _web: {
            backgroundImage: panelGroundImage(theme),
            boxShadow: panelSheetShadow(theme),
            _classNames: herdWebClasses('herd-slide-right'),
        },
    },
    container: {
        flex: 1,
        minWidth: 0,
        backgroundColor: workspaceGround(theme),
        _web: {
            backgroundImage: workspaceGroundImage(theme),
        },
    },
    tabBar: {
        height: 46,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 2,
        paddingHorizontal: 10,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    compactHeader: {
        alignItems: 'stretch',
        backgroundColor: theme.colors.surface,
    },
    compactActions: {
        width: '100%',
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    tabBarActions: {
        flexShrink: 0,
        marginLeft: 'auto',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    browseButton: {
        width: 40,
        height: 36,
        flexShrink: 0,
        marginBottom: -1,
        alignItems: 'center',
        justifyContent: 'center',
        borderTopLeftRadius: theme.kilv.radius,
        borderTopRightRadius: theme.kilv.radius,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: 'transparent',
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition'),
        },
    },
    tabScroller: {
        flexGrow: 0,
        flexShrink: 1,
        maxWidth: '100%',
    },
    tabRow: {
        alignItems: 'flex-end',
        gap: 2,
        minHeight: 45,
    },
    tab: {
        height: 36,
        maxWidth: 210,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        marginBottom: -1,
        paddingLeft: 12,
        paddingRight: 6,
        borderTopLeftRadius: theme.kilv.radius,
        borderTopRightRadius: theme.kilv.radius,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: 'transparent',
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition'),
        },
    },
    tabActive: {
        backgroundColor: theme.colors.groupped.background,
        borderColor: panelHairline(theme),
    },
    tabHovered: {
        backgroundColor: panelHoverWash(theme),
    },
    tabText: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    tabTextActive: {
        color: theme.colors.text,
    },
    tabTextSelected: {
        ...Typography.default('semiBold'),
    },
    dirtyDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: theme.colors.kilv.accent,
    },
    tabClose: {
        width: 18,
        height: 18,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.6,
    },
    tabCloseShown: {
        opacity: 1,
    },
    tabCloseHovered: {
        backgroundColor: panelHoverWash(theme),
    },
    fileBar: {
        minHeight: 50,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    fileBarSpacer: {
        flex: 1,
    },
    filePath: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        ...Typography.mono(),
    },
    filePathDirectory: {
        color: theme.colors.kilv.inkFaint,
    },
    filePathName: {
        color: theme.colors.text,
    },
    liveUrl: {
        flex: 1,
        minWidth: 0,
        height: 34,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        backgroundColor: theme.colors.input.background,
    },
    liveUrlText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        color: theme.colors.text,
        ...Typography.mono(),
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
        backgroundColor: workspaceGround(theme),
    },
    hiddenLayer: {
        display: 'none',
    },
    dividerLine: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 1,
        backgroundColor: panelHairline(theme),
    },
    divider: {
        width: DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
        alignSelf: 'stretch',
        backgroundColor: 'transparent',
        zIndex: 5,
        cursor: 'col-resize',
        userSelect: 'none',
        touchAction: 'none',
    } as any,
}));
