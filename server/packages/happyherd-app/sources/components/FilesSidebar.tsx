import * as React from 'react';
import { View, Text, ScrollView, Pressable, Platform, ActivityIndicator } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { storage, useSessionGitStatus, useSessionGitStatusFiles } from '@/sync/storage';
import { GitFileStatus } from '@/sync/gitStatusFiles';
import { gitStatusSync } from '@/sync/gitStatusSync';
import { FileIcon } from '@/components/FileIcon';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { SideChatPanel } from './SideChatPanel';
import type { Session } from '@/sync/storageTypes';
import {
    formatShortcutChord,
    getPreferredShortcutModifier,
    matchesShortcutChord,
    SIDEBAR_PICKER_SHORTCUTS,
    type SidebarPickerShortcutId,
} from '@/keyboard/shortcuts';
import {
    AnimatedClickAwayBackdrop,
    AnimatedPopup,
    LocalBlurHalo,
} from './AnimatedOverlay';
import { MobileGlassSurface } from './MobileGlass';
import { useHeaderHeight } from '@/utils/responsive';
import { useHerdEscapeToClose } from './herd/escape';
import { HerdMenuItem } from './herd/HerdPopover';
import { herdStaggerClass, herdWebClasses } from './herd/motion';
import { HerdCollapse } from './herd/session/Collapse';
import { HerdPanelIconButton } from './herd/panels/PanelIconButton';
import { HerdCountBadge, HerdLineCounts, HerdPanelTab } from './herd/panels/PanelTab';
import {
    panelGroundImage,
    panelHairline,
    panelHoverWash,
    panelMolten,
} from './herd/panels/panelColors';

export type SidebarMode = 'changes' | 'sideChat';
type PickableSidebarMode = Exclude<SidebarMode, 'sideChat'>;

const ALL_PANELS: { key: SidebarMode; icon: keyof typeof Octicons.glyphMap }[] = [
    { key: 'changes', icon: 'git-compare' },
    { key: 'sideChat', icon: 'comment-discussion' },
];

// File panels and one-click side-chat creation share the right-panel picker.
const PICKABLE_PANELS = ALL_PANELS.filter((p) => p.key === 'changes') as Array<{
    key: PickableSidebarMode;
    icon: keyof typeof Octicons.glyphMap;
}>;
function panelIcon(panel: SidebarMode): keyof typeof Octicons.glyphMap {
    return ALL_PANELS.find((p) => p.key === panel)?.icon ?? 'file';
}

function panelLabel(panel: SidebarMode): string {
    switch (panel) {
        case 'changes': return t('files.changes');
        case 'sideChat': return t('sideChat.panelTitle');
    }
}

interface FilesSidebarProps {
    sessionId: string;
    selectedPath?: string | null;
    onFilePress?: (file: GitFileStatus) => void;
    openPanels: SidebarMode[];
    activePanel: SidebarMode | null;
    onOpenPanel: (panel: SidebarMode) => void;
    onSelectPanel: (panel: SidebarMode) => void;
    onClosePanel: (panel: SidebarMode) => void;
    onOpenWorkspace?: () => void;
    canOpenFilePanels: boolean;
    sideChats: Session[];
    activeSideChatId: string | null;
    onSelectSideChat: (id: string) => void;
    onCloseSideChat: (id: string) => void;
    creatingSideChat: boolean;
    canCreateSideChat: boolean;
    onCreateSideChat: () => Promise<boolean>;
    /** Hides the overlay sheet (below 1,100 px) without closing its panels. */
    onHidePanel?: () => void;
    /**
     * Whether the panel is on screen. Below 1,100 px it stays mounted while its
     * sheet is hidden; its menu and shortcuts then stay off.
     */
    presented?: boolean;
}

type FileNode<T = GitFileStatus> = {
    kind: 'file';
    name: string;
    path: string;
    file: T;
};

type DirNode<T = GitFileStatus> = {
    kind: 'dir';
    name: string;
    path: string;
    children: AnyTreeNode<T>[];
};

type AnyTreeNode<T = GitFileStatus> = FileNode<T> | DirNode<T>;

// Legacy alias for existing code
type TreeNode = AnyTreeNode<GitFileStatus>;

const PATH_SEPARATOR = ' / ';
const ADD_MENU_WIDTH = 250;
const INDENT_PX = 10;

// Build a nested tree from a flat file list, then path-compress any dir chain
// where every intermediate dir has a single directory child. So a/b/c/file.ts
// where a and b each have only one dir child becomes a single "a / b / c" node.
function buildTree<T extends { fullPath: string }>(files: T[]): AnyTreeNode<T>[] {
    // De-dup files by fullPath (a file can appear in both staged and unstaged).
    const uniq = new Map<string, T>();
    for (const file of files) {
        if (!uniq.has(file.fullPath)) uniq.set(file.fullPath, file);
    }

    const root: DirNode<T> = { kind: 'dir', name: '', path: '', children: [] };

    for (const file of uniq.values()) {
        // Support both forward and back slashes (Windows paths)
        const parts = file.fullPath.split(/[/\\]/).filter(Boolean);
        let cursor = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const segment = parts[i];
            const nextPath = cursor.path ? `${cursor.path}/${segment}` : segment;
            let child = cursor.children.find((c) => c.kind === 'dir' && c.name === segment) as DirNode<T> | undefined;
            if (!child) {
                child = { kind: 'dir', name: segment, path: nextPath, children: [] };
                cursor.children.push(child);
            }
            cursor = child;
        }
        const leafName = parts[parts.length - 1] ?? file.fullPath;
        cursor.children.push({
            kind: 'file',
            name: leafName,
            path: file.fullPath,
            file,
        });
    }

    sortTree(root);
    compressTree(root);
    return root.children;
}

function sortTree<T>(node: DirNode<T>) {
    node.children.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
        if (child.kind === 'dir') sortTree(child);
    }
}

function compressTree<T>(node: DirNode<T>) {
    for (const child of node.children) {
        if (child.kind === 'dir') compressTree(child);
    }
    while (
        node !== undefined &&
        node.kind === 'dir' &&
        node.children.length === 1 &&
        node.children[0].kind === 'dir'
    ) {
        const only = node.children[0] as DirNode<T>;
        node.name = node.name ? `${node.name}${PATH_SEPARATOR}${only.name}` : only.name;
        node.path = only.path;
        node.children = only.children;
    }
}

// Depth-first walk that returns the filtered tree. A dir is kept if any of its
// descendants match; a file is kept if its path contains the query.
function filterTree<T>(nodes: AnyTreeNode<T>[], query: string): AnyTreeNode<T>[] {
    if (!query) return nodes;
    const q = query.toLowerCase();
    const result: AnyTreeNode<T>[] = [];
    for (const node of nodes) {
        if (node.kind === 'file') {
            if (node.path.toLowerCase().includes(q)) result.push(node);
        } else {
            const filteredChildren = filterTree(node.children, query);
            if (filteredChildren.length > 0) {
                result.push({ ...node, children: filteredChildren });
            }
        }
    }
    return result;
}

function collectDirPaths<T>(nodes: AnyTreeNode<T>[], acc: string[] = []): string[] {
    for (const node of nodes) {
        if (node.kind === 'dir') {
            acc.push(node.path);
            collectDirPaths(node.children, acc);
        }
    }
    return acc;
}

export const FilesSidebar = React.memo<FilesSidebarProps>(({
    sessionId,
    selectedPath,
    onFilePress,
    openPanels,
    activePanel,
    onOpenPanel,
    onSelectPanel,
    onClosePanel,
    onOpenWorkspace,
    canOpenFilePanels,
    sideChats,
    activeSideChatId,
    onSelectSideChat,
    onCloseSideChat,
    creatingSideChat,
    canCreateSideChat,
    onCreateSideChat,
    onHidePanel,
    presented = true,
}) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const headerHeight = useHeaderHeight();
    const preferredModifier = React.useMemo(() => getPreferredShortcutModifier(
        typeof navigator === 'undefined' ? undefined : navigator
    ), []);
    const gitStatusFiles = useSessionGitStatusFiles(sessionId);
    const gitStatus = useSessionGitStatus(sessionId);

    const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

    // Each git status refresh also stores this file list, so opening the
    // sidebar asks for one refresh instead of running git on every update.
    React.useEffect(() => {
        if (!storage.getState().getSessionPathKey(sessionId)) return;
        gitStatusSync.getSync(sessionId).invalidate();
    }, [sessionId]);

    const handleFilePress = React.useCallback((file: GitFileStatus) => {
        if (file.status === 'deleted') return;
        if (onFilePress) {
            onFilePress(file);
            return;
        }
        const encodedPath = btoa(file.fullPath);
        router.push(`/session/${sessionId}/file?path=${encodedPath}`);
    }, [router, sessionId, onFilePress]);

    const allFiles = React.useMemo(() => {
        const staged = gitStatusFiles?.stagedFiles ?? [];
        const unstaged = gitStatusFiles?.unstagedFiles ?? [];
        return [...staged, ...unstaged];
    }, [gitStatusFiles]);

    const tree = React.useMemo(() => buildTree(allFiles), [allFiles]);
    // A file can be both staged and unstaged; its row shows both halves.
    const lineCounts = React.useMemo(() => {
        const totals = new Map<string, { added: number; removed: number }>();
        for (const file of allFiles) {
            const current = totals.get(file.fullPath) ?? { added: 0, removed: 0 };
            totals.set(file.fullPath, {
                added: current.added + file.linesAdded,
                removed: current.removed + file.linesRemoved,
            });
        }
        return totals;
    }, [allFiles]);
    const filteredTree = tree;
    const effectiveCollapsed = collapsed;

    const hasFiles = allFiles.length > 0;

    const toggleDir = React.useCallback((path: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    // Add-panel menu (lists panels not yet open). Open panels live inline as chips.
    const [addMenuOpen, setAddMenuOpen] = React.useState(false);
    // The menu opens under its + button, kept inside the panel.
    const [addButtonX, setAddButtonX] = React.useState(0);
    const [panelWidth, setPanelWidth] = React.useState(0);
    const addMenuPosition = {
        top: headerHeight - 4,
        left: Math.max(8, Math.min(addButtonX, panelWidth - ADD_MENU_WIDTH - 8)),
    };
    React.useEffect(() => {
        setAddMenuOpen(false);
    }, [activePanel, openPanels.length]);

    const pickablePanels = React.useMemo(
        () => canOpenFilePanels ? PICKABLE_PANELS : [],
        [canOpenFilePanels],
    );
    const availablePanels = React.useMemo(
        () => pickablePanels.filter((panel) => !openPanels.includes(panel.key)),
        [openPanels, pickablePanels],
    );
    const availablePickerActionIds = React.useMemo<SidebarPickerShortcutId[]>(() => [
        ...availablePanels.map((panel) => panel.key),
        ...(onOpenWorkspace ? ['workspace' as const] : []),
        'newSideChat',
    ], [availablePanels, onOpenWorkspace]);

    const runPickerAction = React.useCallback((actionId: SidebarPickerShortcutId): boolean => {
        if (actionId === 'newSideChat') {
            if (creatingSideChat || !canCreateSideChat) return false;
            setAddMenuOpen(false);
            void onCreateSideChat();
            return true;
        }
        if (actionId === 'workspace') {
            if (!onOpenWorkspace) return false;
            setAddMenuOpen(false);
            onOpenWorkspace();
            return true;
        }
        const panel = availablePanels.find((candidate) => candidate.key === actionId);
        if (!panel) {
            return false;
        }
        setAddMenuOpen(false);
        onOpenPanel(panel.key);
        return true;
    }, [availablePanels, canCreateSideChat, creatingSideChat, onCreateSideChat, onOpenPanel, onOpenWorkspace]);

    // A hidden panel closes its menu; Escape closes the open menu before the sheet.
    React.useEffect(() => {
        if (!presented) setAddMenuOpen(false);
    }, [presented]);
    useHerdEscapeToClose(Platform.OS === 'web' && presented && addMenuOpen, () => setAddMenuOpen(false));

    React.useEffect(() => {
        const shortcutsActive = presented && (activePanel === null || addMenuOpen);
        if (Platform.OS !== 'web' || typeof window === 'undefined' || !shortcutsActive) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const actionId = availablePickerActionIds.find((candidate) => matchesShortcutChord(
                event,
                preferredModifier,
                SIDEBAR_PICKER_SHORTCUTS[candidate],
            ));
            if (!actionId || !runPickerAction(actionId)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [activePanel, addMenuOpen, availablePickerActionIds, preferredModifier, presented, runPickerAction]);

    // Empty sidebar: a centred picker of panels to open (no header).
    if (activePanel === null) {
        let pickerIndex = 0;
        return (
            <View style={[styles.container, styles.pickerContainer]}>
                <View style={styles.pickerWrap}>
                    {pickablePanels.map((p) => (
                        <PickerCard
                            key={p.key}
                            index={pickerIndex++}
                            icon={p.icon}
                            title={panelLabel(p.key)}
                            description={t('files.changesPanelDescription')}
                            shortcut={formatShortcutChord(preferredModifier, SIDEBAR_PICKER_SHORTCUTS[p.key])}
                            onPress={() => onOpenPanel(p.key)}
                        />
                    ))}
                    {onOpenWorkspace && (
                        <PickerCard
                            index={pickerIndex++}
                            icon="device-desktop"
                            title={t('workspace.title')}
                            description={t('workspace.browseMachine')}
                            shortcut={formatShortcutChord(preferredModifier, SIDEBAR_PICKER_SHORTCUTS.workspace)}
                            onPress={onOpenWorkspace}
                        />
                    )}
                    <PickerCard
                        index={pickerIndex++}
                        icon="comment-discussion"
                        title={t('sideChat.newChat')}
                        description={t('sideChat.newChatDescription')}
                        shortcut={formatShortcutChord(preferredModifier, SIDEBAR_PICKER_SHORTCUTS.newSideChat)}
                        busy={creatingSideChat}
                        disabled={creatingSideChat || !canCreateSideChat}
                        onPress={() => void onCreateSideChat()}
                    />
                </View>
            </View>
        );
    }

    // The mock's tab strip (`.rpanel-tabs`): Changes first whenever file panels
    // are available, Side chats once the session has any; open panels always.
    const headerPanels = ALL_PANELS
        .map((panel) => panel.key)
        .filter((key) => openPanels.includes(key) || (key === 'changes'
            ? canOpenFilePanels
            : sideChats.length > 0));

    const addMenuContent = (
        <>
            {availablePanels.map((p) => (
                <HerdMenuItem
                    key={p.key}
                    label={panelLabel(p.key)}
                    leading={<Octicons name={p.icon} size={15} color={theme.colors.textSecondary} />}
                    hint={formatShortcutChord(preferredModifier, SIDEBAR_PICKER_SHORTCUTS[p.key])}
                    onPress={() => {
                        setAddMenuOpen(false);
                        onOpenPanel(p.key);
                    }}
                />
            ))}
            {onOpenWorkspace && (
                <HerdMenuItem
                    label={t('workspace.title')}
                    leading={<Octicons name="device-desktop" size={15} color={theme.colors.textSecondary} />}
                    hint={formatShortcutChord(preferredModifier, SIDEBAR_PICKER_SHORTCUTS.workspace)}
                    onPress={() => {
                        setAddMenuOpen(false);
                        onOpenWorkspace();
                    }}
                />
            )}
            <HerdMenuItem
                label={t('sideChat.newChat')}
                disabled={creatingSideChat || !canCreateSideChat}
                leading={creatingSideChat
                    ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    : <Octicons name="comment-discussion" size={15} color={theme.colors.textSecondary} />}
                hint={formatShortcutChord(preferredModifier, SIDEBAR_PICKER_SHORTCUTS.newSideChat)}
                onPress={() => {
                    setAddMenuOpen(false);
                    void onCreateSideChat();
                }}
            />
        </>
    );

    return (
        <View style={styles.container} onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}>
            {/* Panel pill tabs + the add-panel menu, level with the chat header */}
            <View style={[styles.header, { height: headerHeight }]}>
                {/* The pills scroll sideways when the panel is narrow (the phone sheet), so Add and Hide always fit. */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.headerTabs}
                    contentContainerStyle={styles.headerTabsContent}
                    testID="files-sidebar-tabs"
                >
                    {headerPanels.map((key) => {
                        const open = openPanels.includes(key);
                        return (
                            <HerdPanelTab
                                key={key}
                                label={panelLabel(key)}
                                active={key === activePanel}
                                onPress={() => (open ? onSelectPanel(key) : onOpenPanel(key))}
                                onClose={open ? () => onClosePanel(key) : undefined}
                                closeLabel={t('files.closePanel')}
                                maxWidth={200}
                                renderIcon={(color) => <Octicons name={panelIcon(key)} size={14} color={color} />}
                                meta={key === 'changes'
                                    ? (gitStatus ? <HerdLineCounts added={gitStatus.linesAdded} removed={gitStatus.linesRemoved} /> : null)
                                    : <HerdCountBadge count={sideChats.length} />}
                            />
                        );
                    })}
                </ScrollView>
                <View onLayout={(event) => setAddButtonX(event.nativeEvent.layout.x)}>
                    <HerdPanelIconButton
                        accessibilityLabel={t('files.addPanel')}
                        active={addMenuOpen}
                        expanded={addMenuOpen}
                        onPress={() => setAddMenuOpen((v) => !v)}
                        renderIcon={(color) => <Octicons name="plus" size={15} color={color} />}
                    />
                </View>
                <View style={styles.headerSpacer} />
                {onHidePanel ? (
                    <HerdPanelIconButton
                        accessibilityLabel={t('files.hidePanel')}
                        onPress={onHidePanel}
                        testID="files-sidebar-hide"
                        renderIcon={(color) => <Octicons name="x" size={15} color={color} />}
                    />
                ) : null}
            </View>

            {activePanel === 'sideChat' ? (
                <SideChatPanel
                    sideChats={sideChats}
                    activeSideChatId={activeSideChatId}
                    onSelectSideChat={onSelectSideChat}
                    onCloseSideChat={onCloseSideChat}
                    creatingSideChat={creatingSideChat}
                    canCreateSideChat={canCreateSideChat}
                    onCreateSideChat={onCreateSideChat}
                />
            ) : (
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                    {!hasFiles ? (
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIconWrap}>
                                <Octicons name="check" size={22} color={theme.colors.kilv.accent} />
                            </View>
                            <Text style={styles.emptyTitle}>{t('files.noChangesTitle')}</Text>
                            <Text style={styles.emptySubtitle}>{t('files.noChangesSubtitle')}</Text>
                        </View>
                    ) : (
                        <>
                            <View style={styles.summary}>
                                <Octicons name="git-branch" size={14} color={theme.colors.kilv.inkFaint} />
                                {gitStatus?.branch ? (
                                    <Text numberOfLines={1} style={styles.summaryBranch}>{gitStatus.branch}</Text>
                                ) : null}
                                <View style={styles.summarySpacer} />
                                <Text numberOfLines={1} style={styles.summaryText}>
                                    {t('files.summary', {
                                        staged: gitStatusFiles?.stagedFiles.length ?? 0,
                                        unstaged: gitStatusFiles?.unstagedFiles.length ?? 0,
                                    })}
                                </Text>
                                {gitStatus ? (
                                    <HerdLineCounts added={gitStatus.linesAdded} removed={gitStatus.linesRemoved} size={12} />
                                ) : null}
                            </View>
                            <View style={styles.tree}>
                                {filteredTree.map((node) => (
                                    <TreeNodeRow
                                        key={node.path}
                                        node={node}
                                        depth={0}
                                        selectedPath={selectedPath ?? null}
                                        collapsed={effectiveCollapsed}
                                        lineCounts={lineCounts}
                                        onToggleDir={toggleDir}
                                        onFilePress={handleFilePress}
                                    />
                                ))}
                            </View>
                        </>
                    )}
                </ScrollView>
            )}

            {addMenuOpen && (
                Platform.OS === 'web' ? (
                    <>
                        <Pressable
                            accessible={false}
                            style={styles.menuBackdrop}
                            onPress={() => setAddMenuOpen(false)}
                        />
                        <View accessibilityRole="menu" style={[styles.menuCard, styles.webMenuCard, addMenuPosition]}>{addMenuContent}</View>
                    </>
                ) : (
                    <>
                        <AnimatedClickAwayBackdrop
                            onPress={() => setAddMenuOpen(false)}
                            style={styles.menuBackdrop}
                        />
                        <AnimatedPopup style={[styles.menuCard, addMenuPosition]}>
                            <LocalBlurHalo borderRadius={14} expansion={12} />
                            <MobileGlassSurface
                                enabled
                                nativeEffect
                                intensity={82}
                                glassEffectStyle="regular"
                                tintColor={theme.colors.glass.overlayTint}
                                style={styles.menuSurface}
                            >
                                {addMenuContent}
                            </MobileGlassSurface>
                        </AnimatedPopup>
                    </>
                )
            )}
        </View>
    );
});

/** A card of the empty panel's picker (mock `.rp-pick`): icon, title, description and shortcut. */
const PickerCard = React.memo(function PickerCard({
    index,
    icon,
    title,
    description,
    shortcut,
    busy = false,
    disabled = false,
    onPress,
}: {
    index: number;
    icon: keyof typeof Octicons.glyphMap;
    title: string;
    description: string;
    shortcut: string;
    busy?: boolean;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={({ pressed }: any) => [
                styles.pickerCard,
                (hovered || pressed) && !disabled && styles.pickerCardHovered,
                disabled && styles.pickerCardDisabled,
                index === 0 ? styles.entrance0 : index === 1 ? styles.entrance1 : styles.entrance2,
            ]}
        >
            <View style={styles.pickerIcon}>
                {busy
                    ? <ActivityIndicator size="small" color={theme.colors.kilv.accent} />
                    : <Octicons name={icon} size={17} color={theme.colors.kilv.accent} />}
            </View>
            <View style={styles.pickerText}>
                <Text style={styles.pickerCardText} numberOfLines={1}>{title}</Text>
                <Text style={styles.pickerDescription} numberOfLines={2}>{description}</Text>
            </View>
            <Text style={styles.pickerShortcut}>{shortcut}</Text>
        </Pressable>
    );
});

interface TreeNodeRowProps {
    node: TreeNode;
    depth: number;
    selectedPath: string | null;
    collapsed: Set<string>;
    lineCounts: ReadonlyMap<string, { added: number; removed: number }>;
    onToggleDir: (path: string) => void;
    onFilePress: (file: GitFileStatus) => void;
}

const CHEVRON_DURATION = 160;
const EASING = Easing.out(Easing.cubic);

const TreeNodeRow = React.memo(function TreeNodeRow({ node, depth, selectedPath, collapsed, lineCounts, onToggleDir, onFilePress }: TreeNodeRowProps) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const leftPad = 10 + depth * INDENT_PX;

    if (node.kind === 'dir') {
        const isCollapsed = collapsed.has(node.path);
        return (
            <View>
                <Pressable
                    onPress={() => onToggleDir(node.path)}
                    accessibilityRole="button"
                    aria-expanded={!isCollapsed}
                    onHoverIn={() => setHovered(true)}
                    onHoverOut={() => setHovered(false)}
                    style={({ pressed }) => [styles.row, { paddingLeft: leftPad }, (hovered || pressed) && styles.rowHovered]}
                >
                    <View style={styles.chevron}>
                        <AnimatedChevron collapsed={isCollapsed} color={theme.colors.kilv.inkFaint} />
                    </View>
                    <Octicons name={isCollapsed ? 'file-directory' : 'file-directory-open-fill'} size={14} color={theme.colors.kilv.moltenDeep} />
                    <Text style={styles.dirName} numberOfLines={1}>{node.name}</Text>
                </Pressable>
                <HerdCollapse open={!isCollapsed}>
                    {node.children.map((child) => (
                        <TreeNodeRow
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            selectedPath={selectedPath}
                            collapsed={collapsed}
                            lineCounts={lineCounts}
                            onToggleDir={onToggleDir}
                            onFilePress={onFilePress}
                        />
                    ))}
                </HerdCollapse>
            </View>
        );
    }

    const isSelected = selectedPath === node.path;
    const isDeleted = node.file.status === 'deleted';
    const counts = lineCounts.get(node.path);
    return (
        <Pressable
            onPress={() => onFilePress(node.file)}
            accessibilityRole="button"
            disabled={isDeleted}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={({ pressed }) => [
                styles.row,
                { paddingLeft: leftPad + 18 },
                (hovered || pressed) && !isDeleted && styles.rowHovered,
                isSelected && !isDeleted && styles.rowSelected,
                isDeleted && styles.rowDeleted,
            ]}
        >
            {isSelected && !isDeleted ? <View style={styles.rowSelectedBar} /> : null}
            <FileIcon fileName={node.name} size={15} />
            <Text
                style={[styles.fileName, isDeleted && styles.fileNameDeleted]}
                numberOfLines={1}
            >
                {node.name}
            </Text>
            {counts ? <HerdLineCounts added={counts.added} removed={counts.removed} /> : null}
        </Pressable>
    );
});

const AnimatedChevron = React.memo(function AnimatedChevron({ collapsed, color, size = 12 }: { collapsed: boolean; color: string; size?: number }) {
    const rotation = useSharedValue(collapsed ? 0 : 90);
    React.useEffect(() => {
        rotation.value = withTiming(collapsed ? 0 : 90, { duration: CHEVRON_DURATION, easing: EASING });
    }, [collapsed, rotation]);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
    }));
    return (
        <Animated.View style={animatedStyle}>
            <Octicons name="chevron-right" size={size} color={color} />
        </Animated.View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        borderLeftWidth: 1,
        borderLeftColor: panelHairline(theme),
        _web: {
            backgroundImage: panelGroundImage(theme),
        },
    },
    header: {
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 10,
        gap: 6,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
        overflow: 'hidden',
        zIndex: 2,
    },
    headerSpacer: {
        flex: 1,
    },
    // The pills take their own width until the row runs out, then scroll.
    headerTabs: {
        flexGrow: 0,
        flexShrink: 1,
        minWidth: 0,
    },
    headerTabsContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    pickerContainer: {
        justifyContent: 'center',
    },
    pickerWrap: {
        paddingHorizontal: 20,
        paddingVertical: 26,
        gap: 10,
    },
    pickerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        _web: {
            cursor: 'pointer',
            transition: `border-color ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}, transform ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
        },
    },
    // Picker cards rise in one after another (one `_web` block per style).
    entrance0: {
        _web: { _classNames: herdWebClasses('herd-rise-sm') },
    },
    entrance1: {
        _web: { _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(1)) },
    },
    entrance2: {
        _web: { _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(2)) },
    },
    pickerCardHovered: {
        borderColor: panelMolten(theme, theme.dark ? 0.55 : 0.5),
        transform: [{ translateY: -1 }],
    },
    pickerCardDisabled: {
        opacity: theme.kilv.disabledOpacity,
    },
    pickerIcon: {
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    pickerText: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    pickerCardText: {
        fontSize: 14.5,
        lineHeight: 19,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    pickerDescription: {
        fontSize: 12.5,
        lineHeight: 17,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    pickerShortcut: {
        flexShrink: 0,
        fontSize: 11,
        lineHeight: 14,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    menuBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 3,
    },
    menuCard: {
        position: 'absolute',
        width: ADD_MENU_WIDTH,
        maxWidth: '90%',
        zIndex: 4,
    },
    menuSurface: {
        padding: 4,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: Platform.select({
            web: theme.colors.surface,
            ios: theme.colors.glass.overlay,
            android: theme.colors.glass.backgroundStrong,
            default: theme.colors.surface,
        }),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.glass.border,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    // Inline on web so the menu stays inside the panel it belongs to.
    webMenuCard: {
        padding: 6,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        _web: {
            boxShadow: theme.kilv.shadow,
            _classNames: herdWebClasses('herd-pop'),
        },
    },
    summary: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    summaryBranch: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    summarySpacer: {
        flex: 1,
    },
    summaryText: {
        flexShrink: 0,
        fontSize: 12.5,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    list: {
        flex: 1,
    },
    listContent: {
        flexGrow: 1,
        paddingBottom: 16,
    },
    tree: {
        paddingHorizontal: 6,
        paddingTop: 6,
    },
    row: {
        position: 'relative',
        minHeight: 30,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingRight: 10,
        paddingVertical: 5,
        borderRadius: 6,
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition'),
        },
    },
    rowHovered: {
        backgroundColor: panelHoverWash(theme),
    },
    rowSelected: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    rowSelectedBar: {
        position: 'absolute',
        left: 0,
        top: 7,
        bottom: 7,
        width: 2,
        borderRadius: 2,
        backgroundColor: theme.colors.kilv.accent,
    },
    rowDeleted: {
        opacity: 0.5,
    },
    chevron: {
        width: 12,
        alignItems: 'center',
    },
    dirName: {
        flex: 1,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    fileName: {
        flex: 1,
        fontSize: 12.5,
        color: theme.colors.text,
        ...Typography.mono(),
    },
    fileNameDeleted: {
        textDecorationLine: 'line-through',
        color: theme.colors.textSecondary,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 26,
        paddingVertical: 30,
        gap: 10,
    },
    emptyIconWrap: {
        width: 54,
        height: 54,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        _web: {
            boxShadow: theme.kilv.glowMoltenSoft,
        },
    },
    emptyTitle: {
        fontSize: 16,
        color: theme.colors.text,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptySubtitle: {
        fontSize: 14,
        color: theme.colors.kilv.inkFaint,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
