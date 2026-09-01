import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BubblePressable } from '@/components/BubblePressable';
import { Text } from '@/components/StyledText';
import { Modal } from '@/modal';
import { machineCreateDirectory, machineGetDirectoryTree, type DirectoryTreeNode } from '@/sync/ops';
import {
    MAX_WORKSPACE_CONTEXT_ITEMS,
    workspaceContextEntryKey,
    type WorkspaceContextEntry,
} from '@/sync/workspaceContext';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { parentHostPath } from '@/utils/hostPath';
import { sortWorkspaceContextTreeEntries } from '@/utils/machineWorkspaceContext';

export function MachineWorkspaceContextPicker({
    machineId,
    initialDirectory,
    platform,
    online,
    entries,
    onToggle,
    onDone,
}: {
    machineId: string;
    initialDirectory: string;
    platform?: string;
    online: boolean;
    entries: readonly WorkspaceContextEntry[];
    onToggle: (entry: WorkspaceContextEntry) => void;
    onDone?: () => void;
}) {
    const { theme } = useUnistyles();
    const [currentDirectory, setCurrentDirectory] = React.useState(initialDirectory);
    const [tree, setTree] = React.useState<DirectoryTreeNode | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [creatingFolder, setCreatingFolder] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [reloadToken, setReloadToken] = React.useState(0);

    React.useEffect(() => {
        setCurrentDirectory(initialDirectory);
    }, [initialDirectory, machineId]);

    React.useEffect(() => {
        let cancelled = false;
        if (!online || !currentDirectory) {
            setTree(null);
            setError(t('workspace.offlineDescription'));
            return;
        }
        setLoading(true);
        setError(null);
        void machineGetDirectoryTree(machineId, currentDirectory, 1).then((response) => {
            if (cancelled) return;
            setLoading(false);
            if (!response.success || !response.tree || response.tree.type !== 'directory') {
                setTree(null);
                setError(response.error ?? t('workspace.readErrorTitle'));
                return;
            }
            setTree(response.tree);
        });
        return () => { cancelled = true; };
    }, [currentDirectory, machineId, online, reloadToken]);

    const selectedKeys = React.useMemo(
        () => new Set(entries.map(workspaceContextEntryKey)),
        [entries],
    );
    const toggle = React.useCallback((path: string, kind: 'file' | 'directory') => {
        const entry = { path, kind, source: { kind: 'machine' as const, machineId } };
        if (!selectedKeys.has(workspaceContextEntryKey(entry)) && entries.length >= MAX_WORKSPACE_CONTEXT_ITEMS) {
            Modal.alert(
                t('common.files'),
                t('workspace.selectedItemsCount', {
                    count: MAX_WORKSPACE_CONTEXT_ITEMS,
                    max: MAX_WORKSPACE_CONTEXT_ITEMS,
                }),
            );
            return;
        }
        onToggle(entry);
    }, [entries.length, machineId, onToggle, selectedKeys]);

    const createFolder = React.useCallback(async () => {
        if (creatingFolder || !online) return;
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
            const response = await machineCreateDirectory(machineId, { directory: currentDirectory, directoryName });
            if (!response.success || !response.path) {
                Modal.alert(t('common.error'), response.error ?? t('workspace.createFolderFailed'));
                return;
            }
            setCurrentDirectory(response.path);
        } finally {
            setCreatingFolder(false);
        }
    }, [creatingFolder, currentDirectory, machineId, online]);

    const children = sortWorkspaceContextTreeEntries(tree?.children ?? []);
    const currentSelected = selectedKeys.has(workspaceContextEntryKey({
        path: currentDirectory,
        source: { kind: 'machine', machineId },
    }));

    return (
        <View style={styles.container}>
            <View style={styles.toolbar}>
                <BubblePressable
                    accessibilityRole="button"
                    accessibilityLabel={t('workspace.parent')}
                    onPress={() => setCurrentDirectory(parentHostPath(currentDirectory, platform))}
                    style={styles.iconButton}
                >
                    <Ionicons name="arrow-up" size={17} color={theme.colors.textSecondary} />
                </BubblePressable>
                <Text style={[styles.path, { color: theme.colors.text }]} numberOfLines={1}>{currentDirectory}</Text>
                <BubblePressable
                    accessibilityRole="button"
                    accessibilityLabel={t('workspace.refresh')}
                    onPress={() => setReloadToken((value) => value + 1)}
                    style={styles.iconButton}
                >
                    <Ionicons name="refresh" size={17} color={theme.colors.textSecondary} />
                </BubblePressable>
                {onDone && (
                    <BubblePressable
                        accessibilityRole="button"
                        accessibilityLabel={t('uiCopy.done')}
                        onPress={onDone}
                        style={styles.iconButton}
                    >
                        <Ionicons name="checkmark" size={19} color={theme.colors.textLink} />
                    </BubblePressable>
                )}
            </View>

            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={currentSelected
                        ? t('uiCopy.removeValueFromMessageContext', { value1: currentDirectory })
                        : t('uiCopy.attachValueToNextMessage', { value1: currentDirectory })}
                    onPress={() => toggle(currentDirectory, 'directory')}
                    style={({ pressed }) => [styles.action, { borderColor: theme.colors.divider, opacity: pressed ? 0.7 : 1 }]}
                >
                    <Ionicons name={currentSelected ? 'checkmark-circle' : 'folder-outline'} size={16} color={theme.colors.textLink} />
                    <Text style={[styles.actionText, { color: theme.colors.text }]}>{t('workspace.addCurrentFolder')}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('workspace.newFolder')}
                    accessibilityState={{ disabled: creatingFolder || !online }}
                    disabled={creatingFolder || !online}
                    onPress={() => void createFolder()}
                    style={({ pressed }) => [styles.action, { borderColor: theme.colors.divider, opacity: creatingFolder || !online ? 0.4 : pressed ? 0.7 : 1 }]}
                >
                    <Ionicons name="folder-outline" size={16} color={theme.colors.textLink} />
                    <Text style={[styles.actionText, { color: theme.colors.text }]}>{t('workspace.newFolder')}</Text>
                </Pressable>
            </View>

            <Text style={[styles.count, { color: theme.colors.textSecondary }]}>
                {t('workspace.selectedItemsCount', { count: entries.length, max: MAX_WORKSPACE_CONTEXT_ITEMS })}
            </Text>

            {loading ? (
                <View style={styles.message}><ActivityIndicator color={theme.colors.textSecondary} /></View>
            ) : error ? (
                <View style={styles.message}>
                    <Ionicons name="warning-outline" size={18} color={theme.colors.warning} />
                    <Text style={[styles.messageText, { color: theme.colors.textSecondary }]}>{error}</Text>
                </View>
            ) : children.length === 0 ? (
                <View style={styles.message}>
                    <Text style={[styles.messageText, { color: theme.colors.textSecondary }]}>{t('workspace.emptyFolder')}</Text>
                </View>
            ) : (
                <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                    {children.map((entry) => {
                        const selected = selectedKeys.has(workspaceContextEntryKey({
                            path: entry.path,
                            source: { kind: 'machine', machineId },
                        }));
                        return (
                            <Pressable
                                key={entry.path}
                                accessibilityRole="button"
                                onPress={() => entry.type === 'directory' && setCurrentDirectory(entry.path)}
                                style={({ pressed }) => [styles.row, { borderBottomColor: theme.colors.divider, opacity: pressed ? 0.72 : 1 }]}
                            >
                                <Ionicons
                                    name={entry.type === 'directory' ? 'folder-outline' : 'document-outline'}
                                    size={18}
                                    color={theme.colors.textSecondary}
                                />
                                <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>{entry.name}</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={selected
                                        ? t('uiCopy.removeValueFromMessageContext', { value1: entry.name })
                                        : t('uiCopy.attachValueToNextMessage', { value1: entry.name })}
                                    onPress={(event) => {
                                        event.stopPropagation?.();
                                        toggle(entry.path, entry.type);
                                    }}
                                    hitSlop={7}
                                    style={styles.addButton}
                                >
                                    <Ionicons
                                        name={selected ? 'checkmark-circle' : 'add-circle-outline'}
                                        size={20}
                                        color={selected ? theme.colors.success : theme.colors.textLink}
                                    />
                                </Pressable>
                                {entry.type === 'directory' && <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />}
                            </Pressable>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    container: { minHeight: 340, maxHeight: 560, gap: 8, padding: 14 },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    path: { flex: 1, fontSize: 12, ...Typography.mono() },
    actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    action: { minHeight: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { fontSize: 12, ...Typography.default('semiBold') },
    count: { fontSize: 11, ...Typography.default() },
    list: { maxHeight: 360 },
    row: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
    name: { flex: 1, fontSize: 13, ...Typography.default() },
    addButton: { minWidth: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
    message: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 18 },
    messageText: { textAlign: 'center', fontSize: 12, ...Typography.default() },
}));
