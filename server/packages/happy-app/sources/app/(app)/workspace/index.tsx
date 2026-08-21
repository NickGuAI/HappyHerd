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
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FileContentPanel } from '@/components/FileViewPanel';
import { FileIcon } from '@/components/FileIcon';
import { Text } from '@/components/StyledText';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import {
    machineGetDirectoryTree,
    machineCreateDirectory,
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
    const requestedMachineId = param(params.machineId);
    const requestedPath = param(params.path);
    const attachmentMode = mode === 'attach' && !!sessionId;
    const desktopSplit = (Platform.OS === 'web' || Platform.OS === 'macos') && width >= 900;

    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(requestedMachineId ?? null);
    const selectedMachine = React.useMemo(
        () => machines.find((machine) => machine.id === selectedMachineId) ?? null,
        [machines, selectedMachineId],
    );
    const [currentDirectory, setCurrentDirectory] = React.useState('');
    const [pathDraft, setPathDraft] = React.useState('');
    const [tree, setTree] = React.useState<DirectoryTreeNode | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [directoryError, setDirectoryError] = React.useState<{ kind: WorkspaceDirectoryErrorKind; detail?: string } | null>(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
    const [headerRightSlot, setHeaderRightSlot] = React.useState<React.ReactNode>(null);
    const [fileDirty, setFileDirty] = React.useState(false);
    const [creatingFolder, setCreatingFolder] = React.useState(false);
    const [reloadToken, setReloadToken] = React.useState(0);
    const [stagedEntries, setStagedEntries] = React.useState<Map<string, WorkspaceContextEntry>>(
        () => new Map((sessionId ? getWorkspaceContextEntries(sessionId) : []).map((entry) => [entry.path, entry])),
    );
    const handleUploadedFile = React.useCallback((filePath: string) => {
        if (attachmentMode && selectedMachineId) {
            setStagedEntries((current) => {
                if (current.size >= MAX_WORKSPACE_CONTEXT_ITEMS) return current;
                const next = new Map(current);
                next.set(filePath, {
                    path: filePath,
                    kind: 'file',
                    source: { kind: 'machine', machineId: selectedMachineId },
                });
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

    const openDirectory = React.useCallback((path: string) => {
        guardUnsavedChanges(() => {
            const resolvedPath = resolveAbsolutePath(path, selectedMachine?.metadata?.homeDir);
            setCurrentDirectory(resolvedPath);
            setPathDraft(resolvedPath);
            setSelectedFile(null);
            setSearchQuery('');
        });
    }, [guardUnsavedChanges, selectedMachine?.metadata?.homeDir]);

    const switchMachine = React.useCallback((machine: Machine) => {
        if (attachmentMode) return;
        guardUnsavedChanges(() => setSelectedMachineId(machine.id));
    }, [attachmentMode, guardUnsavedChanges]);

    const toggleFavorite = React.useCallback((path: string) => {
        if (!selectedMachine) return;
        const current = storage.getState().settings.favoriteMachinePaths;
        sync.applySettings({
            favoriteMachinePaths: toggleWorkspaceFavorite(current, selectedMachine.id, path),
        });
    }, [selectedMachine]);

    const selectFile = React.useCallback((path: string) => {
        guardUnsavedChanges(() => setSelectedFile(path));
    }, [guardUnsavedChanges]);

    const toggleStagedEntry = React.useCallback((path: string, kind: 'file' | 'directory') => {
        if (!selectedMachineId) return;
        setStagedEntries((current) => {
            const next = new Map(current);
            if (next.has(path)) {
                next.delete(path);
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
            next.set(path, {
                path,
                kind,
                source: { kind: 'machine', machineId: selectedMachineId },
            });
            return next;
        });
    }, [selectedMachineId]);

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
            openDirectory(response.path);
            setReloadToken((value) => value + 1);
        } finally {
            setCreatingFolder(false);
        }
    }, [creatingFolder, currentDirectory, openDirectory, selectedMachine]);

    const commitAttachments = React.useCallback(() => {
        if (!attachmentMode || !sessionId || !selectedMachine) return;
        const existing = getWorkspaceContextEntries(sessionId);
        existing.forEach((entry) => {
            if (!stagedEntries.has(entry.path)) removeWorkspaceContextEntry(sessionId, entry.path);
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
        <View style={[styles.browserPane, desktopSplit && styles.browserPaneDesktop]}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.browserContent}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                    {t('settings.machines')}
                </Text>
                {machines.length === 0 ? (
                    <EmptyState icon="desktop-outline" title={t('workspace.selectMachine')} description={t('workspace.noMachines')} />
                ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                        {machines.map((machine) => {
                            const selected = machine.id === selectedMachineId;
                            const online = isMachineOnline(machine);
                            return (
                                <Pressable
                                    key={machine.id}
                                    disabled={attachmentMode}
                                    onPress={() => switchMachine(machine)}
                                    style={({ pressed }) => [
                                        styles.machineChip,
                                        { borderColor: selected ? theme.colors.textLink : theme.colors.divider },
                                        selected && { backgroundColor: theme.colors.surfaceSelected },
                                        pressed && { opacity: 0.75 },
                                        attachmentMode && !selected && { display: 'none' },
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected, disabled: attachmentMode }}
                                >
                                    <View style={[styles.statusDot, { backgroundColor: online ? theme.colors.success : theme.colors.textSecondary }]} />
                                    <Text style={{ color: theme.colors.text, ...Typography.default('semiBold') }} numberOfLines={1}>
                                        {machineName(machine)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                )}

                {selectedMachine && (
                    <>
                        <View style={styles.pathRow}>
                            <TextInput
                                value={pathDraft}
                                onChangeText={setPathDraft}
                                onSubmitEditing={() => pathDraft.trim() && openDirectory(pathDraft.trim())}
                                placeholder={t('workspace.pathPlaceholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={[
                                    styles.pathInput,
                                    {
                                        color: theme.colors.text,
                                        backgroundColor: theme.colors.input.background,
                                        borderColor: theme.colors.divider,
                                    },
                                ]}
                            />
                            <Pressable
                                onPress={() => pathDraft.trim() && openDirectory(pathDraft.trim())}
                                style={({ pressed }) => [styles.goButton, { backgroundColor: theme.colors.button.primary.background, opacity: pressed ? 0.8 : 1 }]}
                            >
                                <Text style={{ color: theme.colors.button.primary.tint, ...Typography.default('semiBold') }}>{t('workspace.go')}</Text>
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

                        <View style={[styles.searchRow, { backgroundColor: theme.colors.input.background }]}>
                            <Ionicons name="search" size={17} color={theme.colors.textSecondary} />
                            <TextInput
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholder={t('workspace.searchPlaceholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                style={[styles.searchInput, { color: theme.colors.text }]}
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
                                        attached={stagedEntries.has(entry.path)}
                                        attachmentMode={attachmentMode}
                                        onOpen={() => entry.type === 'directory' ? openDirectory(entry.path) : selectFile(entry.path)}
                                        onToggleAttach={() => toggleStagedEntry(entry.path, entry.type)}
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
            <View style={[styles.viewerHeader, { borderBottomColor: theme.colors.divider }]}>
                {!desktopSplit && (
                    <Pressable onPress={() => guardUnsavedChanges(() => setSelectedFile(null))} style={styles.viewerBackButton} accessibilityRole="button">
                        <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
                        <Text style={{ color: theme.colors.text, ...Typography.default() }}>{t('workspace.mobileBackToFiles')}</Text>
                    </Pressable>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.viewerTitle, { color: theme.colors.text }]} numberOfLines={1}>
                        {selectedFile.split(/[\\/]/).pop() || selectedFile}
                    </Text>
                    <Text style={[styles.viewerPath, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {selectedFile}
                    </Text>
                </View>
                {attachmentMode && (
                    <Pressable
                        onPress={() => toggleStagedEntry(selectedFile, 'file')}
                        style={({ pressed }) => [styles.attachButton, { borderColor: theme.colors.divider, opacity: pressed ? 0.75 : 1 }]}
                    >
                        <Ionicons
                            name={stagedEntries.has(selectedFile) ? 'checkmark-circle' : 'attach-outline'}
                            size={17}
                            color={stagedEntries.has(selectedFile) ? theme.colors.success : theme.colors.textLink}
                        />
                    </Pressable>
                )}
                {headerRightSlot}
            </View>
            <MachineFileViewer
                machineId={selectedMachine.id}
                filePath={selectedFile}
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

    const gated = !workspaceEnabled && !attachmentMode;

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
                        <View style={[styles.attachmentFooter, { borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
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
    canWrite,
    onHeaderRightSlotChange,
    onDirtyChange,
}: {
    machineId: string;
    filePath: string;
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
            style={({ pressed }) => [styles.pathAction, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
        >
            <Ionicons name={icon} size={17} color={theme.colors.textSecondary} />
            <Text style={[styles.pathActionLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
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
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>{title}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {paths.map((path) => (
                    <Pressable
                        key={path}
                        onPress={() => onPress(path)}
                        style={({ pressed }) => [styles.pathChip, { borderColor: theme.colors.divider, opacity: pressed ? 0.7 : 1 }]}
                    >
                        <Text style={{ color: theme.colors.text, ...Typography.mono() }} numberOfLines={1}>
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
}: {
    entry: DirectoryTreeNode;
    selected: boolean;
    attached: boolean;
    attachmentMode: boolean;
    onOpen: () => void;
    onToggleAttach: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onOpen}
            style={({ pressed }) => [
                styles.fileRow,
                { borderBottomColor: theme.colors.divider },
                selected && { backgroundColor: theme.colors.surfaceSelected },
                pressed && { opacity: 0.75 },
            ]}
            accessibilityRole="button"
        >
            {entry.type === 'directory'
                ? <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
                : <FileIcon fileName={entry.name} size={20} />}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.colors.text, ...Typography.default() }} numberOfLines={1}>{entry.name}</Text>
                {entry.type === 'file' && (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 11, ...Typography.default() }}>{formatBytes(entry.size)}</Text>
                )}
            </View>
            {attachmentMode && (
                <Pressable
                    onPress={(event) => {
                        event.stopPropagation?.();
                        onToggleAttach();
                    }}
                    hitSlop={8}
                    style={styles.attachButton}
                    accessibilityLabel={attached
                        ? t('uiCopy.removeValueFromMessageContext', { value1: entry.name })
                        : t('uiCopy.attachValueToNextMessage', { value1: entry.name })}
                >
                    <Ionicons
                        name={attached ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={attached ? theme.colors.success : theme.colors.textSecondary}
                    />
                </Pressable>
            )}
            {entry.type === 'directory' && <Ionicons name="chevron-forward" size={17} color={theme.colors.textSecondary} />}
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
            <Ionicons name={icon} size={34} color={theme.colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{title}</Text>
            {description && <Text style={[styles.emptyDescription, { color: theme.colors.textSecondary }]}>{description}</Text>}
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
            <Ionicons name="warning-outline" size={34} color={theme.colors.warning} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{copy.title}</Text>
            <Text style={[styles.emptyDescription, { color: theme.colors.textSecondary }]}>{copy.description}</Text>
            {!!error.detail && <Text style={[styles.errorDetail, { color: theme.colors.textSecondary }]}>{error.detail}</Text>}
            <Pressable onPress={onRetry} style={({ pressed }) => [styles.retryButton, { borderColor: theme.colors.divider, opacity: pressed ? 0.7 : 1 }]}>
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
    browserPane: { flex: 1, minWidth: 0 },
    browserPaneDesktop: {
        ...desktopWorkspaceBrowserLayout,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.colors.divider,
    },
    browserContent: { padding: 16, gap: 14, paddingBottom: 32 },
    viewerPane: { flex: 1, minWidth: 0, backgroundColor: theme.colors.surface },
    sectionLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, ...Typography.default('semiBold') },
    chipRow: { gap: 8, paddingRight: 8 },
    machineChip: { maxWidth: 240, minHeight: 38, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    pathRow: { flexDirection: 'row', gap: 8 },
    pathInput: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: Platform.OS === 'web' ? 9 : 8, ...Typography.mono() },
    goButton: { minWidth: 50, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    pathActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    uploadStatusRow: { paddingHorizontal: 2 },
    pathAction: { minWidth: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 8 },
    pathActionLabel: { fontSize: 10, ...Typography.default() },
    pathChip: { maxWidth: 220, borderWidth: 1, borderRadius: 8, minHeight: 32, justifyContent: 'center', paddingHorizontal: 9 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9, paddingHorizontal: 10 },
    searchInput: { flex: 1, paddingVertical: Platform.OS === 'web' ? 9 : 8, ...Typography.default() },
    loadingState: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
    fileList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    fileRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
    attachButton: { minWidth: 38, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    viewerHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    viewerBackButton: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginRight: 4 },
    viewerTitle: { fontSize: 14, ...Typography.default('semiBold') },
    viewerPath: { fontSize: 11, ...Typography.mono() },
    emptyState: { minHeight: 190, flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
    emptyTitle: { textAlign: 'center', fontSize: 16, ...Typography.default('semiBold') },
    emptyDescription: { maxWidth: 460, textAlign: 'center', fontSize: 13, lineHeight: 19, ...Typography.default() },
    errorDetail: { maxWidth: 520, textAlign: 'center', fontSize: 11, ...Typography.mono() },
    retryButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, marginTop: 4 },
    attachmentFooter: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
    footerButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
    selectionCount: { flex: 1, textAlign: 'center', fontSize: 12, ...Typography.default() },
    primaryButton: { minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    gate: { flex: 1, width: '100%', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', padding: 20 },
}));
