import * as React from 'react';
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FileContentPanel } from '@/components/FileViewPanel';
import { FileIcon } from '@/components/FileIcon';
import { Text } from '@/components/StyledText';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import {
    machineGetDirectoryTree,
    machineCreateDirectory,
    machineDeleteFile,
    machineDeleteDirectory,
    machineReadFile,
    machineWriteFile,
    type DirectoryTreeNode,
} from '@/sync/ops';
import { storage, useAllMachines, useSetting } from '@/sync/storage';
import { sync } from '@/sync/sync';
import type { Machine } from '@/sync/storageTypes';
import {
    MAX_WORKSPACE_CONTEXT_ITEMS,
    addWorkspaceContextEntry,
    getWorkspaceContextEntries,
    removeWorkspaceContextEntry,
    subscribeWorkspaceContext,
    workspaceContextEntryKey,
    type WorkspaceContextEntry,
} from '@/sync/workspaceContext';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { hostRoot, parentHostPath } from '@/utils/hostPath';
import { isMachineOnline } from '@/utils/machineUtils';
import {
    classifyWorkspaceDirectoryError,
    desktopWorkspaceBrowserLayout,
    pickWorkspaceDirectory,
    pickWorkspaceMachine,
    rememberWorkspacePath,
    toggleWorkspaceFavorite,
    type WorkspaceDirectoryErrorKind,
} from '@/utils/machineWorkspace';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { useMachineFileUpload } from '@/hooks/useMachineFileUpload';
import { MachineFileUploadStatus } from '@/components/MachineFileUploadStatus';
import { WorkspaceLinkViewer } from '@/components/WorkspaceLinkViewer';
import { workspaceLinkViewerKey } from '@/components/WorkspaceLinkViewerModel';
import { isWorkspacePathDeleted, normalizeWorkspaceLocalhostUrl } from '@/components/desktopFileWorkspaceModel';
import { herdWebClasses } from '@/components/herd/motion';
import {
    panelGroundImage,
    panelHairline,
    panelHoverWash,
    panelMolten,
    workspaceGround,
} from '@/components/herd/panels/panelColors';
import type { WorkspaceLinkRouteParams } from '@/utils/markdownWorkspaceLink';
import {
    dismissWorkspaceLinkToOrigin,
    useWorkspaceLinkDismissGuard,
} from '@/-session/workspaceLinkNavigation';

const EMPTY_WORKSPACE_CONTEXT_ENTRIES: readonly WorkspaceContextEntry[] = Object.freeze([]);

function param(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function machineName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

function formatBytes(bytes: number | undefined): string | undefined {
    if (bytes === undefined) return undefined;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function errorCopy(kind: WorkspaceDirectoryErrorKind): { title: string; description: string } {
    if (kind === 'offline') {
        return { title: t('workspace.offlineTitle'), description: t('workspace.offlineDescription') };
    }
    if (kind === 'permission') {
        return { title: t('workspace.permissionDeniedTitle'), description: t('workspace.permissionDeniedDescription') };
    }
    if (kind === 'missing') {
        return { title: t('workspace.missingPathTitle'), description: t('workspace.missingPathDescription') };
    }
    return { title: t('workspace.readErrorTitle'), description: t('errors.tryAgain') };
}

export default function MachineWorkspaceScreen() {
    const params = useLocalSearchParams<{
        mode?: string | string[];
        sessionId?: string | string[];
        machineId?: string | string[];
        path?: string | string[];
        originSessionId?: string | string[];
        absolutePath?: string | string[];
        line?: string | string[];
        column?: string | string[];
    }>();
    if (param(params.mode) === 'link') {
        return <WorkspaceLinkRouteScreen params={params} />;
    }
    return <MachineWorkspaceBrowser />;
}

function WorkspaceLinkRouteScreen({ params }: {
    params: {
        mode?: string | string[];
        originSessionId?: string | string[];
        machineId?: string | string[];
        absolutePath?: string | string[];
        line?: string | string[];
        column?: string | string[];
    };
}) {
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const {
        onSendingChange: onFeedbackSendingChange,
        onDirtyChange,
        guardDismiss,
    } = useWorkspaceLinkDismissGuard();
    const originSessionId = param(params.originSessionId);
    const machineId = param(params.machineId);
    const absolutePath = param(params.absolutePath);
    const line = param(params.line);
    const column = param(params.column);
    const reference = React.useMemo<WorkspaceLinkRouteParams | null>(() => (
        originSessionId && machineId && absolutePath
            ? {
                mode: 'link',
                originSessionId,
                machineId,
                absolutePath,
                ...(line ? { line } : {}),
                ...(column ? { column } : {}),
            }
            : null
    ), [absolutePath, column, line, machineId, originSessionId]);

    if (!reference) {
        return (
            <View style={styles.screen}>
                <Stack.Screen options={{ headerShown: true, title: t('common.fileViewer') }} />
                <EmptyState icon="warning-outline" title={t('workspace.readErrorTitle')} description={t('errors.tryAgain')} />
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerShown: false }} />
            <WorkspaceLinkViewer
                key={workspaceLinkViewerKey(reference)}
                reference={reference}
                headerTopInset={safeArea.top}
                onBack={() => guardDismiss(() => router.back())}
                onDirtyChange={onDirtyChange}
                onFeedbackSendingChange={onFeedbackSendingChange}
                onFeedbackSent={(receipt) => guardDismiss(() => dismissWorkspaceLinkToOrigin(
                    router,
                    reference.originSessionId,
                    receipt.localId,
                ))}
            />
        </View>
    );
}

type WorkspaceDeletedItem = {
    machineId: string;
    path: string;
    type: 'file' | 'directory';
    platform?: string;
};

function canDeleteWorkspaceItem(machine: Machine | null | undefined, type: 'file' | 'directory'): boolean {
    return Platform.OS === 'web' && !!machine && isMachineOnline(machine) && (type === 'directory'
        ? machine.metadata?.supportsDirectoryDelete === true
        : machine.metadata?.supportsFileDelete === true);
}

export function MachineWorkspaceBrowser({
    embedded = false,
    initialMachineId,
    initialPath,
    workspaceContextSessionId,
    onNavigate,
    onFilePress,
    onLocalhostUrlPress,
    onDeleted,
    hasUnsavedChanges,
}: {
    embedded?: boolean;
    initialMachineId?: string;
    initialPath?: string;
    workspaceContextSessionId?: string;
    onNavigate?: () => void;
    onFilePress?: (file: { machineId: string; path: string }) => void;
    onLocalhostUrlPress?: (target: { machineId: string; url: string }) => void;
    onDeleted?: (item: WorkspaceDeletedItem) => void;
    hasUnsavedChanges?: (item: WorkspaceDeletedItem) => boolean;
}) {
    const router = useRouter();
    const params = useLocalSearchParams<{
        mode?: string | string[];
        sessionId?: string | string[];
        machineId?: string | string[];
        path?: string | string[];
    }>();
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const workspaceEnabled = useSetting('machineWorkspace');
    const recentPaths = useSetting('recentMachinePaths');
    const favoritePaths = useSetting('favoriteMachinePaths');
    const machines = useAllMachines({ includeOffline: true });

    const mode = param(params.mode);
    const sessionId = param(params.sessionId);
    const requestedMachineId = initialMachineId ?? param(params.machineId);
    const requestedPath = initialPath ?? param(params.path);
    const attachmentMode = mode === 'attach' && !!sessionId;
    const embeddedContextMode = embedded && !!workspaceContextSessionId;
    const contextSelectionMode = attachmentMode || embeddedContextMode;
    const selectionSessionId = attachmentMode ? sessionId : embeddedContextMode ? workspaceContextSessionId : undefined;
    const desktopSplit = (Platform.OS === 'web' || Platform.OS === 'macos') && width >= 900;

    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(requestedMachineId ?? null);
    const selectedMachine = React.useMemo(
        () => machines.find((machine) => machine.id === selectedMachineId) ?? null,
        [machines, selectedMachineId],
    );
    const [currentDirectory, setCurrentDirectory] = React.useState('');
    const [pathDraft, setPathDraft] = React.useState('');
    const [localhostUrlDraft, setLocalhostUrlDraft] = React.useState('');
    const [localhostUrlError, setLocalhostUrlError] = React.useState(false);
    const [tree, setTree] = React.useState<DirectoryTreeNode | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [directoryError, setDirectoryError] = React.useState<{ kind: WorkspaceDirectoryErrorKind; detail?: string } | null>(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
    const [headerRightSlot, setHeaderRightSlot] = React.useState<React.ReactNode>(null);
    const [fileDirty, setFileDirty] = React.useState(false);
    const [creatingFolder, setCreatingFolder] = React.useState(false);
    const [deleting, setDeleting] = React.useState(false);
    const deletePending = React.useRef(false);
    const currentSelection = React.useRef({ machines, selectedMachineId, currentDirectory, selectedFile, selectionSessionId });
    currentSelection.current = { machines, selectedMachineId, currentDirectory, selectedFile, selectionSessionId };
    const [reloadToken, setReloadToken] = React.useState(0);
    const [stagedEntries, setStagedEntries] = React.useState<Map<string, WorkspaceContextEntry>>(
        () => new Map((selectionSessionId ? getWorkspaceContextEntries(selectionSessionId) : [])
            .map((entry) => [workspaceContextEntryKey(entry), entry])),
    );
    const embeddedContextEntries = React.useSyncExternalStore(
        subscribeWorkspaceContext,
        () => embeddedContextMode && workspaceContextSessionId
            ? getWorkspaceContextEntries(workspaceContextSessionId)
            : EMPTY_WORKSPACE_CONTEXT_ENTRIES,
        () => embeddedContextMode && workspaceContextSessionId
            ? getWorkspaceContextEntries(workspaceContextSessionId)
            : EMPTY_WORKSPACE_CONTEXT_ENTRIES,
    );
    React.useEffect(() => {
        if (embeddedContextMode) return;
        setStagedEntries(new Map(
            (selectionSessionId ? getWorkspaceContextEntries(selectionSessionId) : [])
                .map((entry) => [workspaceContextEntryKey(entry), entry]),
        ));
    }, [embeddedContextMode, selectionSessionId]);
    const visibleContextEntries = React.useMemo(
        () => embeddedContextMode
            ? new Map(embeddedContextEntries.map((entry) => [workspaceContextEntryKey(entry), entry]))
            : stagedEntries,
        [embeddedContextEntries, embeddedContextMode, stagedEntries],
    );
    const handleUploadedFile = React.useCallback((filePath: string) => {
        if (attachmentMode && selectedMachineId) {
            setStagedEntries((current) => {
                if (current.size >= MAX_WORKSPACE_CONTEXT_ITEMS) return current;
                const next = new Map(current);
                const entry: WorkspaceContextEntry = {
                    path: filePath,
                    kind: 'file',
                    source: { kind: 'machine', machineId: selectedMachineId },
                };
                next.set(workspaceContextEntryKey(entry), entry);
                return next;
            });
        }
        setReloadToken((value) => value + 1);
    }, [attachmentMode, selectedMachineId]);
    const uploader = useMachineFileUpload({
        machineId: selectedMachineId,
        directory: currentDirectory,
        targetLabel: selectedMachine ? machineName(selectedMachine) : undefined,
        maxFiles: attachmentMode ? MAX_WORKSPACE_CONTEXT_ITEMS - stagedEntries.size : undefined,
        onUploaded: handleUploadedFile,
    });
    React.useEffect(() => {
        uploader.reset();
    }, [currentDirectory, selectedMachineId]);

    React.useEffect(() => {
        if (selectedMachineId && machines.some((machine) => machine.id === selectedMachineId)) return;
        const next = pickWorkspaceMachine(machines, requestedMachineId, recentPaths);
        setSelectedMachineId(next?.id ?? null);
    }, [machines, recentPaths, requestedMachineId, selectedMachineId]);

    React.useEffect(() => {
        if (!selectedMachine) {
            setCurrentDirectory('');
            setPathDraft('');
            setTree(null);
            setSelectedFile(null);
            return;
        }
        const nextDirectory = pickWorkspaceDirectory(
            selectedMachine,
            selectedMachine.id === requestedMachineId ? requestedPath : undefined,
            recentPaths,
        );
        const resolvedDirectory = resolveAbsolutePath(nextDirectory, selectedMachine.metadata?.homeDir);
        setCurrentDirectory(resolvedDirectory);
        setPathDraft(resolvedDirectory);
        setTree(null);
        setSelectedFile(null);
        setDirectoryError(null);
        setSearchQuery('');
    }, [selectedMachine?.id, requestedMachineId, requestedPath]);

    const rememberSuccessfulPath = React.useCallback((machineId: string, path: string) => {
        const current = storage.getState().settings.recentMachinePaths;
        const next = rememberWorkspacePath(current, machineId, path);
        if (current[0]?.machineId === machineId && current[0]?.path === path) return;
        sync.applySettings({ recentMachinePaths: next });
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        if (!selectedMachine || !currentDirectory) {
            setLoading(false);
            setTree(null);
            setDirectoryError(null);
            return;
        }
        if (!isMachineOnline(selectedMachine)) {
            setLoading(false);
            setTree(null);
            setDirectoryError({ kind: 'offline' });
            return;
        }

        setLoading(true);
        setDirectoryError(null);
        void machineGetDirectoryTree(selectedMachine.id, currentDirectory, 1).then((response) => {
            if (cancelled) return;
            setLoading(false);
            if (!response.success || !response.tree || response.tree.type !== 'directory') {
                setTree(null);
                setDirectoryError({
                    kind: classifyWorkspaceDirectoryError(response.error, true),
                    detail: response.error,
                });
                return;
            }
            setTree(response.tree);
            setPathDraft(currentDirectory);
            rememberSuccessfulPath(selectedMachine.id, currentDirectory);
        });

        return () => {
            cancelled = true;
        };
    }, [currentDirectory, reloadToken, rememberSuccessfulPath, selectedMachine?.id, selectedMachine?.active]);

    const guardUnsavedChanges = React.useCallback((action: () => void) => {
        if (!fileDirty) {
            action();
            return;
        }
        void Modal.confirm(
            t("uiCopy.discardUnsavedChanges"),
            t("uiCopy.yourCurrentFileEditsHaveNotBeenSaved"),
            { cancelText: t('common.cancel'), confirmText: t('common.discard'), destructive: true },
        ).then((confirmed) => {
            if (confirmed) action();
        });
    }, [fileDirty]);

    const applyDirectory = React.useCallback((path: string) => {
        guardUnsavedChanges(() => {
            const resolvedPath = resolveAbsolutePath(path, selectedMachine?.metadata?.homeDir);
            setCurrentDirectory(resolvedPath);
            setPathDraft(resolvedPath);
            setSelectedFile(null);
            setSearchQuery('');
        });
    }, [guardUnsavedChanges, selectedMachine?.metadata?.homeDir]);

    const openDirectory = React.useCallback((path: string) => {
        onNavigate?.();
        applyDirectory(path);
    }, [applyDirectory, onNavigate]);

    const switchMachine = React.useCallback((machine: Machine) => {
        if (attachmentMode) return;
        onNavigate?.();
        guardUnsavedChanges(() => setSelectedMachineId(machine.id));
    }, [attachmentMode, guardUnsavedChanges, onNavigate]);

    const toggleFavorite = React.useCallback((path: string) => {
        if (!selectedMachine) return;
        const current = storage.getState().settings.favoriteMachinePaths;
        sync.applySettings({
            favoriteMachinePaths: toggleWorkspaceFavorite(current, selectedMachine.id, path),
        });
    }, [selectedMachine]);

    const selectFile = React.useCallback((path: string) => {
        guardUnsavedChanges(() => {
            if (selectedMachine && onFilePress) {
                onFilePress({ machineId: selectedMachine.id, path });
                return;
            }
            setSelectedFile(path);
        });
    }, [guardUnsavedChanges, onFilePress, selectedMachine]);

    const openLocalhostUrl = React.useCallback(() => {
        if (!selectedMachine || !onLocalhostUrlPress) return;
        const url = normalizeWorkspaceLocalhostUrl(localhostUrlDraft);
        if (!url) {
            setLocalhostUrlError(true);
            return;
        }
        setLocalhostUrlDraft(url);
        setLocalhostUrlError(false);
        onLocalhostUrlPress({ machineId: selectedMachine.id, url });
    }, [localhostUrlDraft, onLocalhostUrlPress, selectedMachine]);

    const toggleStagedEntry = React.useCallback((path: string, kind: 'file' | 'directory') => {
        if (!selectedMachineId) return;
        const entry: WorkspaceContextEntry = {
            path,
            kind,
            source: { kind: 'machine', machineId: selectedMachineId },
        };
        const entryKey = workspaceContextEntryKey(entry);
        if (embeddedContextMode && workspaceContextSessionId) {
            const currentEntries = getWorkspaceContextEntries(workspaceContextSessionId);
            const existing = currentEntries.find((candidate) => workspaceContextEntryKey(candidate) === entryKey);
            if (existing) {
                removeWorkspaceContextEntry(workspaceContextSessionId, existing);
            } else if (!addWorkspaceContextEntry(workspaceContextSessionId, entry)) {
                Modal.alert(
                    t('common.files'),
                    t('workspace.selectedItemsCount', {
                        count: MAX_WORKSPACE_CONTEXT_ITEMS,
                        max: MAX_WORKSPACE_CONTEXT_ITEMS,
                    }),
                );
            }
            return;
        }
        setStagedEntries((current) => {
            const next = new Map(current);
            if (next.has(entryKey)) {
                next.delete(entryKey);
                return next;
            }
            if (next.size >= MAX_WORKSPACE_CONTEXT_ITEMS) {
                Modal.alert(
                    t('common.files'),
                    t('workspace.selectedItemsCount', {
                        count: MAX_WORKSPACE_CONTEXT_ITEMS,
                        max: MAX_WORKSPACE_CONTEXT_ITEMS,
                    }),
                );
                return current;
            }
            next.set(entryKey, entry);
            return next;
        });
    }, [embeddedContextMode, selectedMachineId, workspaceContextSessionId]);

    const createFolder = React.useCallback(async () => {
        if (!selectedMachine || !currentDirectory || creatingFolder || !isMachineOnline(selectedMachine)) return;
        const directoryName = await Modal.prompt(
            t('workspace.newFolder'),
            t('workspace.newFolderPrompt'),
            {
                placeholder: t('workspace.folderNamePlaceholder'),
                cancelText: t('common.cancel'),
                confirmText: t('common.create'),
            },
        );
        if (directoryName === null || !directoryName.trim()) return;
        onNavigate?.();
        setCreatingFolder(true);
        try {
            const response = await machineCreateDirectory(selectedMachine.id, {
                directory: currentDirectory,
                directoryName,
            });
            if (!response.success || !response.path) {
                Modal.alert(t('common.error'), response.error ?? t('workspace.createFolderFailed'));
                return;
            }
            applyDirectory(response.path);
            setReloadToken((value) => value + 1);
        } finally {
            setCreatingFolder(false);
        }
    }, [applyDirectory, creatingFolder, currentDirectory, onNavigate, selectedMachine]);

    const deleteItem = React.useCallback(async (entry: DirectoryTreeNode) => {
        if (deletePending.current || !selectedMachine || !canDeleteWorkspaceItem(selectedMachine, entry.type)) return;
        const target: WorkspaceDeletedItem = {
            machineId: selectedMachine.id,
            path: entry.path,
            type: entry.type,
            platform: selectedMachine.metadata?.platform,
        };
        const sourceDirectory = currentDirectory;
        const sourceSessionId = selectionSessionId;
        const matchesPath = (path: string) => isWorkspacePathDeleted(path, target.path, target.type, target.platform);
        const matchesContext = (item: WorkspaceContextEntry) => item.source.kind === 'machine'
            && item.source.machineId === target.machineId && matchesPath(item.path);
        const dirty = (fileDirty && !!selectedFile && matchesPath(selectedFile)) || hasUnsavedChanges?.(target);
        const message = t(target.type === 'directory' ? 'workspace.deleteFolderConfirm' : 'workspace.deleteFileConfirm', { path: target.path });
        deletePending.current = true;
        setDeleting(true);
        try {
            const confirmed = await Modal.confirm(
                t(target.type === 'directory' ? 'workspace.deleteFolderTitle' : 'workspace.deleteFileTitle'),
                dirty ? `${message}\n\n${t('uiCopy.yourCurrentFileEditsHaveNotBeenSaved')}` : message,
                { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
            );
            if (!confirmed) return;
            const targetMachine = currentSelection.current.machines.find((machine) => machine.id === target.machineId);
            if (!canDeleteWorkspaceItem(targetMachine, target.type)) {
                Modal.alert(t('common.error'), t('workspace.deleteItemFailed'));
                return;
            }
            const response = target.type === 'directory'
                ? await machineDeleteDirectory(target.machineId, target.path)
                : await machineDeleteFile(target.machineId, target.path);
            if (!response.success) {
                Modal.alert(t('common.error'), response.error ?? t('workspace.deleteItemFailed'));
                return;
            }
            if (sourceSessionId) {
                getWorkspaceContextEntries(sourceSessionId).filter(matchesContext).forEach((item) => {
                    removeWorkspaceContextEntry(sourceSessionId, item);
                });
            }
            const current = currentSelection.current;
            if (current.selectionSessionId === sourceSessionId) {
                setStagedEntries((entries) => new Map([...entries].filter(([, item]) => !matchesContext(item))));
            }
            if (current.selectedMachineId === target.machineId) {
                if (current.selectedFile && matchesPath(current.selectedFile)) {
                    setSelectedFile(null);
                    setHeaderRightSlot(null);
                    setFileDirty(false);
                }
                if (target.type === 'directory' && matchesPath(current.currentDirectory)) {
                    const parent = parentHostPath(target.path, target.platform);
                    setCurrentDirectory(parent);
                    setPathDraft(parent);
                    setSearchQuery('');
                } else if (current.currentDirectory === sourceDirectory) {
                    setReloadToken((value) => value + 1);
                }
            }
            onDeleted?.(target);
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('workspace.deleteItemFailed'));
        } finally {
            deletePending.current = false;
            setDeleting(false);
        }
    }, [currentDirectory, fileDirty, hasUnsavedChanges, onDeleted, selectedFile, selectedMachine, selectionSessionId]);

    const commitAttachments = React.useCallback(() => {
        if (!attachmentMode || !sessionId || !selectedMachine) return;
        const existing = getWorkspaceContextEntries(sessionId);
        existing.forEach((entry) => {
            if (!stagedEntries.has(workspaceContextEntryKey(entry))) {
                removeWorkspaceContextEntry(sessionId, entry);
            }
        });
        stagedEntries.forEach((entry) => {
            addWorkspaceContextEntry(sessionId, entry);
        });
        router.back();
    }, [attachmentMode, router, selectedMachine, sessionId, stagedEntries]);

    const children = React.useMemo(() => {
        const entries = tree?.children ?? [];
        const query = searchQuery.trim().toLowerCase();
        return query ? entries.filter((entry) => entry.name.toLowerCase().includes(query)) : entries;
    }, [searchQuery, tree]);

    const currentFavorite = !!selectedMachine && favoritePaths.some((entry) => (
        entry.machineId === selectedMachine.id && entry.path === currentDirectory
    ));
    const machineRecent = selectedMachine
        ? recentPaths.filter((entry) => entry.machineId === selectedMachine.id)
        : [];
    const machineFavorites = selectedMachine
        ? favoritePaths.filter((entry) => entry.machineId === selectedMachine.id)
        : [];

    const browser = (
        <View style={[styles.browserPane, desktopSplit && !embedded && styles.browserPaneDesktop]}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.browserContent}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.sectionLabel}>
                    {t('settings.machines')}
                </Text>
                {machines.length === 0 ? (
                    <EmptyState icon="desktop-outline" title={t('workspace.selectMachine')} description={t('workspace.noMachines')} />
                ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
                        {machines.map((machine) => {
                            const selected = machine.id === selectedMachineId;
                            const online = isMachineOnline(machine);
                            return (
                                <Pressable
                                    key={machine.id}
                                    disabled={attachmentMode}
                                    onPress={() => switchMachine(machine)}
                                    style={({ pressed, hovered }: any) => [
                                        styles.machineChip,
                                        (hovered || pressed) && !selected && styles.machineChipHovered,
                                        selected && styles.machineChipSelected,
                                        !online && !selected && styles.machineChipOffline,
                                        attachmentMode && !selected && { display: 'none' },
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected, disabled: attachmentMode }}
                                    aria-pressed={selected}
                                >
                                    <View style={[styles.statusDot, { backgroundColor: online ? theme.colors.gitAddedText : theme.colors.kilv.inkFaint }]} />
                                    <Text style={[styles.machineChipText, selected && styles.machineChipTextSelected]} numberOfLines={1}>
                                        {machineName(machine)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                )}

                {selectedMachine && (
                    <>
                        {onLocalhostUrlPress ? (
                            <View style={styles.localhostUrlSection}>
                                <Text style={styles.sectionLabel}>
                                    {t('workspace.openLocalhost')}
                                </Text>
                                <View style={styles.pathRow}>
                                    <TextInput
                                        value={localhostUrlDraft}
                                        onChangeText={(value) => {
                                            setLocalhostUrlDraft(value);
                                            setLocalhostUrlError(false);
                                        }}
                                        onSubmitEditing={openLocalhostUrl}
                                        placeholder={t('workspace.localhostUrlPlaceholder')}
                                        placeholderTextColor={theme.colors.kilv.inkFaint}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="url"
                                        returnKeyType="go"
                                        accessibilityLabel={t('workspace.openLocalhost')}
                                        style={[
                                            styles.pathInput,
                                            localhostUrlError && { borderColor: theme.colors.textDestructive },
                                        ]}
                                    />
                                    <Pressable
                                        onPress={openLocalhostUrl}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('workspace.openLocalhost')}
                                        style={({ pressed, hovered }: any) => [styles.goButton, (hovered || pressed) && styles.goButtonHovered]}
                                    >
                                        <Ionicons name="globe-outline" size={14} color={theme.colors.textSecondary} />
                                        <Text style={styles.goButtonText}>{t('workspace.go')}</Text>
                                    </Pressable>
                                </View>
                                {localhostUrlError ? (
                                    <Text accessibilityRole="alert" style={[styles.fieldError, { color: theme.colors.textDestructive }]}>
                                        {t('workspace.invalidLocalhostUrl')}
                                    </Text>
                                ) : null}
                            </View>
                        ) : null}

                        <View style={styles.pathRow}>
                            <TextInput
                                value={pathDraft}
                                onChangeText={setPathDraft}
                                onSubmitEditing={() => pathDraft.trim() && openDirectory(pathDraft.trim())}
                                placeholder={t('workspace.pathPlaceholder')}
                                placeholderTextColor={theme.colors.kilv.inkFaint}
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={styles.pathInput}
                            />
                            <Pressable
                                onPress={() => pathDraft.trim() && openDirectory(pathDraft.trim())}
                                style={({ pressed, hovered }: any) => [styles.goButton, (hovered || pressed) && styles.goButtonHovered]}
                            >
                                <Text style={styles.goButtonText}>{t('workspace.go')}</Text>
                            </Pressable>
                        </View>

                        <View style={styles.pathActions}>
                            <PathAction icon="home-outline" label={t('workspace.home')} onPress={() => openDirectory(selectedMachine.metadata?.homeDir || hostRoot(undefined, selectedMachine.metadata?.platform))} />
                            <PathAction icon="server-outline" label={t('workspace.root')} onPress={() => openDirectory(hostRoot(selectedMachine.metadata?.homeDir, selectedMachine.metadata?.platform))} />
                            <PathAction icon="arrow-up" label={t('workspace.parent')} onPress={() => openDirectory(parentHostPath(currentDirectory, selectedMachine.metadata?.platform))} />
                            <PathAction icon="refresh" label={t('workspace.refresh')} onPress={() => setReloadToken((value) => value + 1)} />
                            <PathAction icon={currentFavorite ? 'star' : 'star-outline'} label={t('workspace.favorites')} onPress={() => toggleFavorite(currentDirectory)} />
                            <PathAction
                                icon="cloud-upload-outline"
                                label={t('workspace.upload')}
                                disabled={attachmentMode && stagedEntries.size >= MAX_WORKSPACE_CONTEXT_ITEMS}
                                onPress={() => void uploader.pickAndUpload()}
                            />
                            <PathAction
                                icon="folder-outline"
                                label={t('workspace.newFolder')}
                                disabled={creatingFolder || !isMachineOnline(selectedMachine)}
                                onPress={() => void createFolder()}
                            />
                        </View>

                        <MachineFileUploadStatus
                            state={uploader.state}
                            canCancel={uploader.canCancel}
                            canRetry={uploader.canRetry}
                            onCancel={uploader.cancel}
                            onRetry={() => void uploader.retry()}
                            style={styles.uploadStatusRow}
                        />

                        {machineFavorites.length > 0 && (
                            <PathChipSection
                                title={t('workspace.favorites')}
                                paths={machineFavorites.map((entry) => entry.path)}
                                homeDir={selectedMachine.metadata?.homeDir}
                                onPress={openDirectory}
                            />
                        )}
                        {machineRecent.length > 0 && (
                            <PathChipSection
                                title={t('workspace.recent')}
                                paths={machineRecent.map((entry) => entry.path)}
                                homeDir={selectedMachine.metadata?.homeDir}
                                onPress={openDirectory}
                            />
                        )}

                        <View style={styles.searchRow}>
                            <Ionicons name="search" size={15} color={theme.colors.kilv.inkFaint} />
                            <TextInput
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholder={t('workspace.searchPlaceholder')}
                                placeholderTextColor={theme.colors.kilv.inkFaint}
                                style={styles.searchInput}
                            />
                        </View>

                        {loading ? (
                            <View style={styles.loadingState}><ActivityIndicator color={theme.colors.textSecondary} /></View>
                        ) : directoryError ? (
                            <DirectoryErrorState error={directoryError} onRetry={() => setReloadToken((value) => value + 1)} />
                        ) : children.length === 0 ? (
                            <EmptyState icon="folder-open-outline" title={t('workspace.emptyFolder')} />
                        ) : (
                            <View style={styles.fileList}>
                                {children.map((entry) => (
                                    <FileRow
                                        key={entry.path}
                                        entry={entry}
                                        selected={selectedFile === entry.path}
                                        attached={!!selectedMachineId && visibleContextEntries.has(workspaceContextEntryKey({
                                            path: entry.path,
                                            source: { kind: 'machine', machineId: selectedMachineId },
                                        }))}
                                        attachmentMode={contextSelectionMode}
                                        onOpen={() => entry.type === 'directory' ? openDirectory(entry.path) : selectFile(entry.path)}
                                        onToggleAttach={() => toggleStagedEntry(entry.path, entry.type)}
                                        onDelete={canDeleteWorkspaceItem(selectedMachine, entry.type) ? () => void deleteItem(entry) : undefined}
                                        deleteDisabled={deleting}
                                    />
                                ))}
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
        </View>
    );

    const viewer = selectedMachine && selectedFile ? (
        <View style={styles.viewerPane}>
            <View style={styles.viewerHeader}>
                {!desktopSplit && (
                    <Pressable
                        onPress={() => {
                            onNavigate?.();
                            guardUnsavedChanges(() => setSelectedFile(null));
                        }}
                        style={styles.viewerBackButton}
                        accessibilityRole="button"
                    >
                        <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
                        <Text style={{ color: theme.colors.text, ...Typography.default() }}>{t('workspace.mobileBackToFiles')}</Text>
                    </Pressable>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.viewerTitle} numberOfLines={1}>
                        {selectedFile.split(/[\\/]/).pop() || selectedFile}
                    </Text>
                    <Text style={styles.viewerPath} numberOfLines={1}>
                        {selectedFile}
                    </Text>
                </View>
                {contextSelectionMode && (
                    <Pressable
                        onPress={() => toggleStagedEntry(selectedFile, 'file')}
                        style={({ pressed }) => [styles.attachButton, { opacity: pressed ? 0.75 : 1 }]}
                    >
                        <Ionicons
                            name={visibleContextEntries.has(workspaceContextEntryKey({
                                path: selectedFile,
                                source: { kind: 'machine', machineId: selectedMachine.id },
                            })) ? 'checkmark-circle' : 'attach-outline'}
                            size={17}
                            color={visibleContextEntries.has(workspaceContextEntryKey({
                                path: selectedFile,
                                source: { kind: 'machine', machineId: selectedMachine.id },
                            })) ? theme.colors.success : theme.colors.textLink}
                        />
                    </Pressable>
                )}
                {headerRightSlot}
            </View>
            <MachineFileViewer
                machineId={selectedMachine.id}
                filePath={selectedFile}
                pathPlatform={selectedMachine.metadata?.platform}
                canWrite={isMachineOnline(selectedMachine)}
                onHeaderRightSlotChange={setHeaderRightSlot}
                onDirtyChange={setFileDirty}
            />
        </View>
    ) : (
        <View style={styles.viewerPane}>
            <EmptyState icon="document-text-outline" title={t('common.fileViewer')} description={t('workspace.browseMachine')} />
        </View>
    );

    const gated = !workspaceEnabled && !attachmentMode && !embedded;

    if (embedded) {
        return gated ? (
            <View style={[styles.gate, { maxWidth: layout.maxWidth }]}>
                <EmptyState
                    icon="lock-closed-outline"
                    title={t('workspace.featureDisabled')}
                    description={t('workspace.featureDisabledDescription')}
                />
            </View>
        ) : browser;
    }

    return (
        <View style={[styles.screen, { backgroundColor: theme.colors.groupped.background }]}>
            <Stack.Screen options={{ title: attachmentMode ? t('workspace.attachTitle') : t('workspace.title') }} />
            {gated ? (
                <View style={[styles.gate, { maxWidth: layout.maxWidth }]}>
                    <EmptyState
                        icon="lock-closed-outline"
                        title={t('workspace.featureDisabled')}
                        description={t('workspace.featureDisabledDescription')}
                    />
                    <Pressable
                        onPress={() => router.push('/settings/features')}
                        style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.colors.button.primary.background, opacity: pressed ? 0.8 : 1 }]}
                    >
                        <Text style={{ color: theme.colors.button.primary.tint, ...Typography.default('semiBold') }}>{t('workspace.openFeatures')}</Text>
                    </Pressable>
                </View>
            ) : (
                <View style={[styles.workspace, { maxWidth: desktopSplit ? 1400 : layout.maxWidth }]}>
                    {desktopSplit ? (
                        <View style={styles.split}>
                            {browser}
                            {viewer}
                        </View>
                    ) : selectedFile ? viewer : browser}
                    {attachmentMode && (
                        <View style={styles.attachmentFooter}>
                            <Pressable onPress={() => router.back()} style={styles.footerButton}>
                                <Text style={{ color: theme.colors.textSecondary, ...Typography.default('semiBold') }}>{t('common.cancel')}</Text>
                            </Pressable>
                            <Text style={[styles.selectionCount, { color: theme.colors.textSecondary }]}>
                                {t('workspace.selectedItemsCount', { count: stagedEntries.size, max: MAX_WORKSPACE_CONTEXT_ITEMS })}
                            </Text>
                            <Pressable
                                onPress={commitAttachments}
                                style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.colors.button.primary.background, opacity: pressed ? 0.8 : 1 }]}
                            >
                                <Text style={{ color: theme.colors.button.primary.tint, ...Typography.default('semiBold') }}>{t('workspace.addToSession')}</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

function MachineFileViewer({
    machineId,
    filePath,
    pathPlatform,
    canWrite,
    onHeaderRightSlotChange,
    onDirtyChange,
}: {
    machineId: string;
    filePath: string;
    pathPlatform?: string;
    canWrite: boolean;
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
    onDirtyChange: (dirty: boolean) => void;
}) {
    const readFile = React.useCallback(
        (path: string) => machineReadFile(machineId, path),
        [machineId],
    );
    const writeFile = React.useCallback(
        (path: string, content: string, expectedHash?: string | null) => (
            machineWriteFile(machineId, path, content, expectedHash)
        ),
        [machineId],
    );

    return (
        <FileContentPanel
            resourceKey={`machine:${machineId}`}
            filePath={filePath}
            pathPlatform={pathPlatform}
            readFile={readFile}
            writeFile={writeFile}
            canWrite={canWrite}
            onHeaderRightSlotChange={onHeaderRightSlotChange}
            onDirtyChange={onDirtyChange}
        />
    );
}

function PathAction({
    icon,
    label,
    disabled = false,
    onPress,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            style={({ pressed, hovered }: any) => [
                styles.pathAction,
                (hovered || pressed) && !disabled && styles.pathActionHovered,
                disabled && styles.pathActionDisabled,
            ]}
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
        >
            <Ionicons name={icon} size={14} color={theme.colors.textSecondary} />
            <Text style={styles.pathActionLabel}>{label}</Text>
        </Pressable>
    );
}

function PathChipSection({
    title,
    paths,
    homeDir,
    onPress,
}: {
    title: string;
    paths: string[];
    homeDir?: string;
    onPress: (path: string) => void;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={{ gap: 5 }}>
            <Text style={styles.sectionLabel}>{title}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
                {paths.map((path) => (
                    <Pressable
                        key={path}
                        onPress={() => onPress(path)}
                        style={({ pressed, hovered }: any) => [styles.pathChip, (hovered || pressed) && styles.pathChipHovered]}
                    >
                        <Text style={styles.pathChipText} numberOfLines={1}>
                            {formatPathRelativeToHome(path, homeDir)}
                        </Text>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

function FileRow({
    entry,
    selected,
    attached,
    attachmentMode,
    onOpen,
    onToggleAttach,
    onDelete,
    deleteDisabled,
}: {
    entry: DirectoryTreeNode;
    selected: boolean;
    attached: boolean;
    attachmentMode: boolean;
    onOpen: () => void;
    onToggleAttach: () => void;
    onDelete?: () => void;
    deleteDisabled: boolean;
}) {
    const { theme } = useUnistyles();
    const fileLabel = (
        <>
            {entry.type === 'directory'
                ? <Ionicons name="folder-outline" size={17} color={theme.colors.kilv.moltenDeep} />
                : <FileIcon fileName={entry.name} size={17} />}
            <View style={styles.fileText}>
                <Text style={styles.fileName} numberOfLines={1}>{entry.name}</Text>
                {entry.type === 'file' && (
                    <Text style={styles.fileSize}>{formatBytes(entry.size)}</Text>
                )}
            </View>
        </>
    );
    const attachButton = attachmentMode && (
        <Pressable
            onPress={(event) => {
                event.stopPropagation?.();
                onToggleAttach();
            }}
            hitSlop={8}
            style={styles.attachButton}
            accessibilityRole={Platform.OS === 'web' ? 'button' : undefined}
            accessibilityLabel={attached
                ? t('uiCopy.removeValueFromMessageContext', { value1: entry.name })
                : t('uiCopy.attachValueToNextMessage', { value1: entry.name })}
        >
            <Ionicons
                name={attached ? 'checkmark-circle' : 'ellipse-outline'}
                size={19}
                color={attached ? theme.colors.textLink : theme.colors.kilv.inkFaint}
            />
        </Pressable>
    );
    const chevron = entry.type === 'directory'
        ? <Ionicons name="chevron-forward" size={15} color={theme.colors.kilv.inkFaint} />
        : null;
    // Tree rows (mock `.tree-row`): rounded, a hover wash, the stone fill and
    // a molten edge for the open file.
    const rowStyle = [
        styles.fileRow,
        selected && styles.fileRowSelected,
    ];

    if (Platform.OS === 'web') {
        return (
            <View style={rowStyle}>
                {selected ? <View style={styles.fileRowSelectedBar} /> : null}
                <Pressable
                    onPress={onOpen}
                    accessibilityRole="button"
                    accessibilityLabel={entry.name}
                    style={({ pressed, hovered }: any) => [styles.fileOpenButton, (hovered || pressed) && styles.fileOpenButtonHovered]}
                >
                    {fileLabel}
                    {chevron}
                </Pressable>
                {attachButton}
                {onDelete && (
                    <Pressable
                        onPress={onDelete}
                        disabled={deleteDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={t('workspace.deleteItemAction', { name: entry.name })}
                        accessibilityState={{ disabled: deleteDisabled }}
                        style={({ pressed, hovered }: any) => [
                            styles.deleteButton,
                            (hovered || pressed) && !deleteDisabled && styles.deleteButtonHovered,
                            deleteDisabled && styles.pathActionDisabled,
                        ]}
                    >
                        <Ionicons name="trash-outline" size={17} color={theme.colors.textDestructive} />
                    </Pressable>
                )}
            </View>
        );
    }

    return (
        <Pressable
            onPress={onOpen}
            style={({ pressed }) => [rowStyle, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
        >
            {fileLabel}
            {attachButton}
            {chevron}
        </Pressable>
    );
}

function EmptyState({
    icon,
    title,
    description,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string;
    description?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.emptyState}>
            <View style={styles.emptyHero}>
                <Ionicons name={icon} size={22} color={theme.colors.kilv.accent} />
            </View>
            <Text style={styles.emptyTitle}>{title}</Text>
            {description && <Text style={styles.emptyDescription}>{description}</Text>}
        </View>
    );
}

function DirectoryErrorState({
    error,
    onRetry,
}: {
    error: { kind: WorkspaceDirectoryErrorKind; detail?: string };
    onRetry: () => void;
}) {
    const { theme } = useUnistyles();
    const copy = errorCopy(error.kind);
    return (
        <View style={styles.emptyState}>
            <View style={styles.emptyHero}>
                <Ionicons name="warning-outline" size={22} color={theme.colors.warning} />
            </View>
            <Text style={styles.emptyTitle}>{copy.title}</Text>
            <Text style={styles.emptyDescription}>{copy.description}</Text>
            {!!error.detail && <Text style={styles.errorDetail}>{error.detail}</Text>}
            <Pressable onPress={onRetry} style={({ pressed, hovered }: any) => [styles.retryButton, (hovered || pressed) && styles.pathActionHovered]}>
                <Ionicons name="refresh" size={16} color={theme.colors.textLink} />
                <Text style={{ color: theme.colors.textLink, ...Typography.default('semiBold') }}>{t('common.retry')}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1 },
    workspace: { flex: 1, width: '100%', alignSelf: 'center', backgroundColor: theme.colors.surface },
    split: { flex: 1, flexDirection: 'row' },
    // File browser (mock `.ws-files`): the panel ground beside the viewer.
    browserPane: {
        flex: 1,
        minWidth: 0,
        backgroundColor: theme.colors.groupped.background,
        _web: { backgroundImage: panelGroundImage(theme) },
    },
    browserPaneDesktop: {
        ...desktopWorkspaceBrowserLayout,
        borderRightWidth: 1,
        borderRightColor: panelHairline(theme),
    },
    browserContent: { paddingHorizontal: 12, paddingTop: 14, gap: 10, paddingBottom: 24 },
    viewerPane: { flex: 1, minWidth: 0, backgroundColor: workspaceGround(theme) },
    sectionLabel: {
        fontSize: 10.5,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: theme.colors.kilv.inkFaint,
        marginTop: 2,
        ...Typography.mono(),
    },
    chipScroll: Platform.OS === 'web' ? { flexGrow: 0, flexShrink: 0 } : {},
    chipRow: { gap: 6, paddingRight: 8 },
    // Machine choices (mock `.chip`, the selected one `.chip-agent`).
    machineChip: {
        maxWidth: 240,
        minHeight: 38,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        borderRadius: theme.kilv.radius,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 11,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition') },
    },
    machineChipHovered: { borderColor: theme.colors.kilv.rimLine },
    machineChipSelected: {
        borderColor: panelMolten(theme, theme.dark ? 0.55 : 0.5),
        backgroundColor: theme.colors.selection.background,
    },
    machineChipOffline: { opacity: 0.55 },
    machineChipText: { fontSize: 12.5, color: theme.colors.textSecondary, ...Typography.mono() },
    machineChipTextSelected: { color: theme.colors.textLink, ...Typography.mono('semiBold') },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    localhostUrlSection: { gap: 6 },
    pathRow: { flexDirection: 'row', gap: 6 },
    // Inputs (mock `.input.input-mono`): sunken, hairline, molten focus.
    pathInput: {
        flex: 1,
        minWidth: 0,
        minHeight: 36,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.text,
        paddingHorizontal: 11,
        paddingVertical: Platform.OS === 'web' ? 8 : 7,
        fontSize: 12.5,
        ...Typography.mono(),
        _web: {
            outlineStyle: 'none',
            _focus: { borderColor: panelMolten(theme, theme.dark ? 0.55 : 0.5) },
        },
    },
    goButton: {
        minWidth: 50,
        minHeight: 36,
        flexDirection: 'row',
        gap: 6,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition', 'herd-press') },
    },
    goButtonHovered: { borderColor: theme.colors.kilv.rimLine },
    goButtonText: { fontSize: 13, color: theme.colors.text, ...Typography.default('semiBold') },
    fieldError: { ...Typography.default(), fontSize: 12, color: theme.colors.textDestructive },
    // Path actions (mock `.ws-actions .btn`), labelled so every action names itself.
    pathActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    uploadStatusRow: { paddingHorizontal: 2 },
    pathAction: {
        minHeight: 30,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: 9,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        backgroundColor: theme.colors.surface,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition', 'herd-press') },
    },
    pathActionHovered: { borderColor: theme.colors.kilv.rimLine, backgroundColor: panelHoverWash(theme) },
    pathActionDisabled: { opacity: theme.kilv.disabledOpacity },
    pathActionLabel: { fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() },
    pathChip: {
        maxWidth: 220,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        borderRadius: theme.borderRadius.sm,
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 9,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition') },
    },
    pathChipHovered: { borderColor: theme.colors.kilv.rimLine },
    pathChipText: { fontSize: 12.5, color: theme.colors.text, ...Typography.mono() },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        backgroundColor: theme.colors.input.background,
        paddingHorizontal: 11,
    },
    searchInput: {
        flex: 1,
        minHeight: 34,
        paddingVertical: Platform.OS === 'web' ? 7 : 8,
        fontSize: 13.5,
        color: theme.colors.text,
        ...Typography.default(),
        _web: { outlineStyle: 'none' },
    },
    loadingState: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
    fileList: { gap: 1, paddingTop: 2 },
    fileRow: {
        position: 'relative',
        minHeight: Platform.OS === 'web' ? 38 : 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: Platform.OS === 'web' ? 2 : 8,
        borderRadius: 6,
    },
    fileRowSelected: { backgroundColor: theme.colors.surfaceHighest },
    fileRowSelectedBar: {
        position: 'absolute',
        left: 0,
        top: 8,
        bottom: 8,
        width: 2,
        borderRadius: 2,
        backgroundColor: theme.colors.kilv.accent,
    },
    fileOpenButton: {
        flex: 1,
        minWidth: 0,
        minHeight: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingHorizontal: 8,
        borderRadius: 6,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition') },
    },
    fileOpenButtonHovered: { backgroundColor: panelHoverWash(theme) },
    fileText: { flex: 1, minWidth: 0 },
    fileName: { fontSize: 13.5, color: theme.colors.text, ...Typography.default() },
    fileSize: { fontSize: 11, color: theme.colors.kilv.inkFaint, ...Typography.mono() },
    // 44 px touch target; the icon stays small.
    deleteButton: {
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition') },
    },
    deleteButtonHovered: { backgroundColor: theme.colors.box.error.background },
    attachButton: { minWidth: 38, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
    viewerHeader: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    viewerBackButton: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginRight: 4 },
    viewerTitle: { fontSize: 14, color: theme.colors.text, ...Typography.default('semiBold') },
    viewerPath: { fontSize: 11.5, color: theme.colors.kilv.inkFaint, ...Typography.mono() },
    emptyState: { minHeight: 190, flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
    // Empty and error hero (mock `.sc-empty .ic-hero`).
    emptyHero: {
        width: 54,
        height: 54,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    emptyTitle: { textAlign: 'center', fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold') },
    emptyDescription: {
        maxWidth: 460,
        textAlign: 'center',
        fontSize: 13.5,
        lineHeight: 19,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    errorDetail: { maxWidth: 520, textAlign: 'center', fontSize: 11, color: theme.colors.kilv.inkFaint, ...Typography.mono() },
    retryButton: {
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: panelHairline(theme),
        borderRadius: theme.kilv.radius,
        paddingHorizontal: 12,
        marginTop: 4,
        _web: { cursor: 'pointer', _classNames: herdWebClasses('herd-transition', 'herd-press') },
    },
    attachmentFooter: {
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: panelHairline(theme),
        backgroundColor: theme.colors.surface,
    },
    footerButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
    selectionCount: { flex: 1, textAlign: 'center', fontSize: 12, ...Typography.default() },
    primaryButton: { minHeight: 40, borderRadius: theme.kilv.radius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    gate: { flex: 1, width: '100%', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', padding: 20 },
}));
