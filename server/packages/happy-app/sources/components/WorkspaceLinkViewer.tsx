import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AgentContentView } from '@/components/AgentContentView';
import { FileContentPanel } from '@/components/FileViewPanel';
import { FileIcon } from '@/components/FileIcon';
import { Text } from '@/components/StyledText';
import { WorkspaceFeedbackComposer } from '@/components/WorkspaceFeedbackComposer';
import { Typography } from '@/constants/Typography';
import { machineGetDirectoryTree, machineReadFile } from '@/sync/ops';
import { useAllMachines, useIsDataReady } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';
import { parentHostPath } from '@/utils/hostPath';
import { isMachineOnline } from '@/utils/machineUtils';
import {
    classifyWorkspaceDirectoryError,
    type WorkspaceDirectoryErrorKind,
} from '@/utils/machineWorkspace';
import type { WorkspaceLinkRouteParams } from '@/utils/markdownWorkspaceLink';
import type { SendMessageReceipt } from '@/sync/sync';

import {
    classifyWorkspaceLinkTree,
    findPinnedWorkspaceLinkMachine,
    workspaceLinkViewerKey,
    type WorkspaceLinkTarget,
} from './WorkspaceLinkViewerModel';

type WorkspaceLinkErrorKind = WorkspaceDirectoryErrorKind | 'machine-missing';

type WorkspaceLinkRetryTarget =
    | { kind: 'reference' }
    | { kind: 'directory'; directoryPath: string }
    | { kind: 'file'; directoryPath: string; filePath: string };

type WorkspaceLinkViewerState =
    | { status: 'loading' }
    | {
        status: 'ready';
        directoryPath: string;
        tree: Extract<WorkspaceLinkTarget, { kind: 'directory' }>['tree'];
        selectedFile: string | null;
    }
    | {
        status: 'error';
        kind: WorkspaceLinkErrorKind;
        detail?: string;
        retryTarget: WorkspaceLinkRetryTarget;
    };

export type WorkspaceLinkViewerProps = {
    reference: WorkspaceLinkRouteParams;
    headerTopInset?: number;
    onBack?: () => void;
    onFeedbackSent: (receipt: SendMessageReceipt) => void;
    onFeedbackSendingChange?: (sending: boolean) => void;
};

function machineName(machine: Machine | null, machineId: string): string {
    return machine?.metadata?.displayName || machine?.metadata?.host || machineId;
}

function pathName(path: string, platform?: string): string {
    const usesWindowsSeparators = platform == null || platform === 'win32';
    const normalized = usesWindowsSeparators
        ? path.replace(/[\\/]+$/, '')
        : path.replace(/\/+$/, '');
    return (usesWindowsSeparators ? normalized.split(/[\\/]/) : normalized.split('/')).pop() || path;
}

function errorCopy(kind: WorkspaceLinkErrorKind): { title: string; description: string } {
    if (kind === 'machine-missing') {
        return { title: t('uiCopy.machineNotFound'), description: t('workspace.linkMachineMissingDescription') };
    }
    if (kind === 'offline') {
        return { title: t('workspace.offlineTitle'), description: t('workspace.offlineDescription') };
    }
    if (kind === 'permission') {
        return { title: t('workspace.permissionDeniedTitle'), description: t('workspace.permissionDeniedDescription') };
    }
    if (kind === 'missing') {
        return { title: t('workspace.missingPathTitle'), description: t('workspace.linkPathMissingDescription') };
    }
    return { title: t('workspace.linkReadErrorTitle'), description: t('errors.tryAgain') };
}

export const WorkspaceLinkViewer = React.memo(function WorkspaceLinkViewer({
    reference,
    headerTopInset = 0,
    onBack,
    onFeedbackSent,
    onFeedbackSendingChange,
}: WorkspaceLinkViewerProps) {
    const { theme } = useUnistyles();
    const isDataReady = useIsDataReady();
    const machines = useAllMachines({ includeOffline: true });
    const machine = React.useMemo(
        () => findPinnedWorkspaceLinkMachine(machines, reference.machineId),
        [machines, reference.machineId],
    );
    const [revision, setRevision] = React.useState(0);
    const [state, setState] = React.useState<WorkspaceLinkViewerState>({ status: 'loading' });
    const [headerRightSlot, setHeaderRightSlot] = React.useState<React.ReactNode>(null);
    const [feedbackSending, setFeedbackSending] = React.useState(false);
    const activeFilePathRef = React.useRef<string | null>(null);
    const activeFileReadGenerationRef = React.useRef(0);
    const activeDirectoryReadGenerationRef = React.useRef(0);

    const handleFeedbackSendingChange = React.useCallback((sending: boolean) => {
        setFeedbackSending(sending);
        onFeedbackSendingChange?.(sending);
    }, [onFeedbackSendingChange]);

    const loadDirectory = React.useCallback(async (directoryPath: string, selectedFile: string | null = null) => {
        const directoryReadGeneration = ++activeDirectoryReadGenerationRef.current;
        activeFilePathRef.current = selectedFile;
        activeFileReadGenerationRef.current += 1;
        setHeaderRightSlot(null);
        setState({ status: 'loading' });
        let response: Awaited<ReturnType<typeof machineGetDirectoryTree>>;
        try {
            response = await machineGetDirectoryTree(reference.machineId, directoryPath, 1);
        } catch (error: unknown) {
            if (activeDirectoryReadGenerationRef.current !== directoryReadGeneration) return;
            const detail = error instanceof Error ? error.message : String(error);
            setState({
                status: 'error',
                kind: classifyWorkspaceDirectoryError(detail, machine ? isMachineOnline(machine) : false),
                detail,
                retryTarget: { kind: 'directory', directoryPath },
            });
            return;
        }
        if (activeDirectoryReadGenerationRef.current !== directoryReadGeneration) return;
        if (!response.success || !response.tree) {
            setState({
                status: 'error',
                kind: classifyWorkspaceDirectoryError(response.error, machine ? isMachineOnline(machine) : false),
                detail: response.error,
                retryTarget: { kind: 'directory', directoryPath },
            });
            return;
        }
        const target = classifyWorkspaceLinkTree(
            response.tree,
            (path) => parentHostPath(path, machine?.metadata?.platform),
        );
        if (target.kind !== 'directory') {
            setState({
                status: 'error',
                kind: 'missing',
                detail: directoryPath,
                retryTarget: { kind: 'directory', directoryPath },
            });
            return;
        }
        setState({
            status: 'ready',
            directoryPath: target.absolutePath,
            tree: target.tree,
            selectedFile,
        });
    }, [machine, reference.machineId]);

    React.useEffect(() => {
        let cancelled = false;
        const directoryReadGeneration = ++activeDirectoryReadGenerationRef.current;
        const isCurrentDirectoryRead = () => !cancelled
            && activeDirectoryReadGenerationRef.current === directoryReadGeneration;
        const cancelDirectoryRead = () => {
            cancelled = true;
            activeDirectoryReadGenerationRef.current += 1;
        };
        activeFilePathRef.current = null;
        activeFileReadGenerationRef.current += 1;
        setHeaderRightSlot(null);

        if (!isDataReady) {
            setState({ status: 'loading' });
            return cancelDirectoryRead;
        }
        if (!machine) {
            setState({ status: 'error', kind: 'machine-missing', retryTarget: { kind: 'reference' } });
            return cancelDirectoryRead;
        }
        if (!isMachineOnline(machine)) {
            setState({ status: 'error', kind: 'offline', retryTarget: { kind: 'reference' } });
            return cancelDirectoryRead;
        }

        setState({ status: 'loading' });
        void machineGetDirectoryTree(reference.machineId, reference.absolutePath, 1).then(async (response) => {
            if (!isCurrentDirectoryRead()) return;
            if (!response.success || !response.tree) {
                setState({
                    status: 'error',
                    kind: classifyWorkspaceDirectoryError(response.error, true),
                    detail: response.error,
                    retryTarget: { kind: 'reference' },
                });
                return;
            }
            const target = classifyWorkspaceLinkTree(
                response.tree,
                (path) => parentHostPath(path, machine.metadata?.platform),
            );
            if (target.kind === 'directory') {
                activeFilePathRef.current = null;
                activeFileReadGenerationRef.current += 1;
                setState({
                    status: 'ready',
                    directoryPath: target.absolutePath,
                    tree: target.tree,
                    selectedFile: null,
                });
                return;
            }

            const parentResponse = await machineGetDirectoryTree(
                reference.machineId,
                target.directoryPath,
                1,
            );
            if (!isCurrentDirectoryRead()) return;
            const parentTree = parentResponse.tree;
            if (!parentResponse.success || !parentTree || parentTree.type !== 'directory') {
                activeFilePathRef.current = target.absolutePath;
                activeFileReadGenerationRef.current += 1;
                setState({
                    status: 'ready',
                    directoryPath: target.directoryPath,
                    tree: {
                        type: 'directory',
                        name: pathName(target.directoryPath, machine.metadata?.platform),
                        path: target.directoryPath,
                        children: [response.tree],
                    },
                    selectedFile: target.absolutePath,
                });
                return;
            }
            activeFilePathRef.current = target.absolutePath;
            activeFileReadGenerationRef.current += 1;
            setState({
                status: 'ready',
                directoryPath: parentTree.path,
                tree: parentTree as Extract<WorkspaceLinkTarget, { kind: 'directory' }>['tree'],
                selectedFile: target.absolutePath,
            });
        }).catch((error: unknown) => {
            if (!isCurrentDirectoryRead()) return;
            const detail = error instanceof Error ? error.message : String(error);
            setState({
                status: 'error',
                kind: classifyWorkspaceDirectoryError(detail, true),
                detail,
                retryTarget: { kind: 'reference' },
            });
        });

        return cancelDirectoryRead;
    }, [isDataReady, machine?.active, machine?.id, reference.absolutePath, reference.machineId, revision]);

    const retry = React.useCallback(() => {
        if (state.status === 'error' && state.retryTarget.kind === 'directory') {
            void loadDirectory(state.retryTarget.directoryPath);
            return;
        }
        if (state.status === 'error' && state.retryTarget.kind === 'file') {
            void loadDirectory(state.retryTarget.directoryPath, state.retryTarget.filePath);
            return;
        }
        setRevision((current) => current + 1);
    }, [loadDirectory, state]);

    const readFile = React.useCallback(async (path: string) => {
        const readGeneration = ++activeFileReadGenerationRef.current;
        const response = await machineReadFile(reference.machineId, path);
        if (
            !response.success
            && activeFilePathRef.current === path
            && activeFileReadGenerationRef.current === readGeneration
        ) {
            setHeaderRightSlot(null);
            setState({
                status: 'error',
                kind: classifyWorkspaceDirectoryError(response.error, machine ? isMachineOnline(machine) : false),
                detail: response.error,
                retryTarget: {
                    kind: 'file',
                    directoryPath: parentHostPath(path, machine?.metadata?.platform),
                    filePath: path,
                },
            });
        }
        return response;
    }, [machine, reference.machineId]);

    const openDirectory = React.useCallback((path: string) => {
        void loadDirectory(path);
    }, [loadDirectory]);

    const selectFile = React.useCallback((path: string) => {
        activeFilePathRef.current = path;
        activeFileReadGenerationRef.current += 1;
        setHeaderRightSlot(null);
        setState((current) => current.status === 'ready'
            ? { ...current, selectedFile: path }
            : current);
    }, []);

    const showDirectory = React.useCallback(() => {
        activeFilePathRef.current = null;
        activeFileReadGenerationRef.current += 1;
        setHeaderRightSlot(null);
        setState((current) => current.status === 'ready'
            ? { ...current, selectedFile: null }
            : current);
    }, []);

    const content = state.status === 'loading' ? (
        <View style={styles.centeredState}>
            <ActivityIndicator color={theme.colors.textSecondary} />
        </View>
    ) : state.status === 'error' ? (
        <WorkspaceLinkErrorState error={state} onRetry={retry} />
    ) : state.selectedFile ? (
        <WorkspaceLinkFile
            machineId={reference.machineId}
            filePath={state.selectedFile}
            directoryPath={state.directoryPath}
            revision={revision}
            readFile={readFile}
            onBack={showDirectory}
            onHeaderRightSlotChange={setHeaderRightSlot}
        />
    ) : (
        <WorkspaceLinkDirectory
            tree={state.tree}
            directoryPath={state.directoryPath}
            platform={machine?.metadata?.platform}
            onOpenDirectory={openDirectory}
            onSelectFile={selectFile}
        />
    );

    const feedbackComposer = (
        <View style={styles.footer}>
            <WorkspaceFeedbackComposer
                key={workspaceLinkViewerKey(reference)}
                originSessionId={reference.originSessionId}
                machineId={reference.machineId}
                machineLabel={machineName(machine, reference.machineId)}
                absolutePath={reference.absolutePath}
                onSent={onFeedbackSent}
                onSendingChange={handleFeedbackSendingChange}
            />
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <View style={[
                styles.header,
                {
                    borderBottomColor: theme.colors.divider,
                    minHeight: 64 + headerTopInset,
                    paddingTop: headerTopInset,
                },
            ]}>
                {onBack ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('common.back')}
                        accessibilityState={{ disabled: feedbackSending }}
                        disabled={feedbackSending}
                        onPress={feedbackSending ? undefined : onBack}
                        style={({ pressed }) => [
                            styles.backButton,
                            feedbackSending && styles.disabled,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
                        <Text style={{ color: theme.colors.text, ...Typography.default() }}>{t('common.back')}</Text>
                    </Pressable>
                ) : null}
                <View style={styles.headerCopy}>
                    <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                        {pathName(reference.absolutePath, machine?.metadata?.platform)}
                    </Text>
                    <Text style={[styles.machine, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {machineName(machine, reference.machineId)}
                    </Text>
                    <Text style={[styles.path, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {reference.absolutePath}
                        {reference.line ? `:${reference.line}${reference.column ? `:${reference.column}` : ''}` : ''}
                    </Text>
                </View>
                {headerRightSlot}
            </View>
            <AgentContentView content={content} input={feedbackComposer} />
        </View>
    );
});

function WorkspaceLinkFile({
    machineId,
    filePath,
    directoryPath,
    revision,
    readFile,
    onBack,
    onHeaderRightSlotChange,
}: {
    machineId: string;
    filePath: string;
    directoryPath: string;
    revision: number;
    readFile: (path: string) => ReturnType<typeof machineReadFile>;
    onBack: () => void;
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.fileDrillDown}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workspace.mobileBackToFiles')}
                onPress={onBack}
                style={({ pressed }) => [
                    styles.directoryToolbar,
                    { borderBottomColor: theme.colors.divider },
                    pressed && styles.pressed,
                ]}
            >
                <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
                <View style={styles.directoryToolbarCopy}>
                    <Text style={[styles.directoryToolbarLabel, { color: theme.colors.text }]}>
                        {t('workspace.mobileBackToFiles')}
                    </Text>
                    <Text style={[styles.directoryToolbarPath, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {directoryPath}
                    </Text>
                </View>
            </Pressable>
            <View style={styles.filePanel}>
                <FileContentPanel
                    key={`${machineId}:${filePath}:${revision}`}
                    resourceKey={`machine:${machineId}`}
                    filePath={filePath}
                    readFile={readFile}
                    canWrite={false}
                    onHeaderRightSlotChange={onHeaderRightSlotChange}
                />
            </View>
        </View>
    );
}

function WorkspaceLinkDirectory({
    tree,
    directoryPath,
    platform,
    onOpenDirectory,
    onSelectFile,
}: {
    tree: Extract<WorkspaceLinkTarget, { kind: 'directory' }>['tree'];
    directoryPath: string;
    platform?: string;
    onOpenDirectory: (path: string) => void;
    onSelectFile: (path: string) => void;
}) {
    const { theme } = useUnistyles();
    const children = tree.children ?? [];
    return (
        <View style={styles.directoryBrowser}>
            <View style={[styles.directoryToolbar, { borderBottomColor: theme.colors.divider }]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('workspace.parent')}
                    onPress={() => onOpenDirectory(parentHostPath(directoryPath, platform))}
                    style={({ pressed }) => [styles.parentButton, pressed && styles.pressed]}
                >
                    <Ionicons name="arrow-up" size={17} color={theme.colors.textSecondary} />
                </Pressable>
                <Text style={[styles.directoryToolbarPath, { color: theme.colors.text }]} numberOfLines={1}>
                    {directoryPath}
                </Text>
            </View>
            {children.length === 0 ? (
                <View style={styles.centeredState}>
                    <Ionicons name="folder-open-outline" size={34} color={theme.colors.textSecondary} />
                    <Text style={[styles.stateTitle, { color: theme.colors.text }]}>{t('workspace.emptyFolder')}</Text>
                </View>
            ) : (
                <ScrollView style={styles.directory} contentContainerStyle={styles.directoryContent}>
                    {children.map((entry) => (
                        <Pressable
                            key={entry.path}
                            accessibilityRole="button"
                            accessibilityLabel={entry.type === 'directory'
                                ? t('uiCopy.openFolderValue', { value1: entry.name })
                                : `${t('common.fileViewer')}: ${entry.name}`}
                            onPress={() => entry.type === 'directory'
                                ? onOpenDirectory(entry.path)
                                : onSelectFile(entry.path)}
                            style={({ pressed }) => [
                                styles.directoryRow,
                                { borderBottomColor: theme.colors.divider },
                                pressed && styles.pressed,
                            ]}
                        >
                            {entry.type === 'directory'
                                ? <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
                                : <FileIcon fileName={entry.name} size={20} />}
                            <View style={styles.directoryCopy}>
                                <Text style={{ color: theme.colors.text, ...Typography.default() }} numberOfLines={1}>
                                    {entry.name}
                                </Text>
                                <Text style={[styles.childPath, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                    {entry.path}
                                </Text>
                            </View>
                            {entry.type === 'directory' ? (
                                <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                            ) : null}
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

function WorkspaceLinkErrorState({
    error,
    onRetry,
}: {
    error: Extract<WorkspaceLinkViewerState, { status: 'error' }>;
    onRetry: () => void;
}) {
    const { theme } = useUnistyles();
    const copy = errorCopy(error.kind);
    return (
        <View style={styles.centeredState}>
            <Ionicons name="warning-outline" size={34} color={theme.colors.warning} />
            <Text style={[styles.stateTitle, { color: theme.colors.text }]}>{copy.title}</Text>
            <Text style={[styles.stateDescription, { color: theme.colors.textSecondary }]}>{copy.description}</Text>
            {error.detail ? (
                <Text style={[styles.errorDetail, { color: theme.colors.textSecondary }]}>{error.detail}</Text>
            ) : null}
            <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [
                    styles.retryButton,
                    { borderColor: theme.colors.divider },
                    pressed && styles.pressed,
                ]}
            >
                <Ionicons name="refresh" size={16} color={theme.colors.textLink} />
                <Text style={{ color: theme.colors.textLink, ...Typography.default('semiBold') }}>
                    {t('common.retry')}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, minWidth: 0 },
    header: {
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backButton: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingRight: 4,
    },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.45 },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { fontSize: 14, ...Typography.default('semiBold') },
    machine: { fontSize: 11, ...Typography.default() },
    path: { fontSize: 10, ...Typography.mono() },
    centeredState: {
        flex: 1,
        minHeight: 190,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 24,
    },
    stateTitle: { textAlign: 'center', fontSize: 16, ...Typography.default('semiBold') },
    stateDescription: { maxWidth: 460, textAlign: 'center', fontSize: 13, lineHeight: 19, ...Typography.default() },
    errorDetail: { maxWidth: 520, textAlign: 'center', fontSize: 11, ...Typography.mono() },
    retryButton: {
        minHeight: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 9,
        paddingHorizontal: 12,
        marginTop: 4,
    },
    fileDrillDown: { flex: 1, minHeight: 0 },
    filePanel: { flex: 1, minHeight: 0 },
    directoryBrowser: { flex: 1, minHeight: 0 },
    directoryToolbar: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    directoryToolbarCopy: { flex: 1, minWidth: 0 },
    directoryToolbarLabel: { fontSize: 12, ...Typography.default('semiBold') },
    directoryToolbarPath: { flex: 1, minWidth: 0, fontSize: 10, ...Typography.mono() },
    parentButton: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
    },
    directory: { flex: 1 },
    directoryContent: { paddingBottom: 24 },
    directoryRow: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    directoryCopy: { flex: 1, minWidth: 0 },
    childPath: { marginTop: 2, fontSize: 10, ...Typography.mono() },
    footer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
}));
