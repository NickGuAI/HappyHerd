import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { BubblePressable } from '@/components/BubblePressable';
import { machineGetDirectoryTree, type DirectoryTreeNode } from '@/sync/ops';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { hostRoot, parentHostPath } from '@/utils/hostPath';

import { t } from '@/text';
export type FavoriteMachinePath = { machineId: string; path: string };

export function MachinePathBrowser({
    machineId,
    homeDir,
    platform,
    online,
    selectedPath,
    favorites,
    onSelectPath,
    onToggleFavorite,
    onDone,
}: {
    machineId: string | null;
    homeDir?: string;
    platform?: string;
    online: boolean;
    selectedPath: string | null;
    favorites: FavoriteMachinePath[];
    onSelectPath: (path: string) => void;
    onToggleFavorite: (path: string) => void;
    onDone?: () => void;
}) {
    const { theme } = useUnistyles();
    const root = React.useMemo(() => hostRoot(homeDir, platform), [homeDir, platform]);
    const [currentDirectory, setCurrentDirectory] = React.useState(homeDir || root);
    const [tree, setTree] = React.useState<DirectoryTreeNode | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        setCurrentDirectory(homeDir || root);
    }, [homeDir, machineId, root]);

    const load = React.useCallback(async () => {
        if (!machineId || !online) {
            setTree(null);
            setError(machineId ? 'Machine is offline' : 'Select a machine first');
            return;
        }
        setLoading(true);
        setError(null);
        const result = await machineGetDirectoryTree(machineId, currentDirectory, 1);
        setLoading(false);
        if (!result.success || !result.tree) {
            setTree(null);
            setError(result.error || 'Unable to read this directory');
            return;
        }
        setTree(result.tree);
    }, [currentDirectory, machineId, online]);

    React.useEffect(() => {
        void load();
    }, [load]);

    const isFavorite = favorites.some((favorite) => (
        favorite.machineId === machineId && favorite.path === currentDirectory
    ));
    const directories = tree?.children?.filter((entry) => entry.type === 'directory') ?? [];
    const files = tree?.children?.filter((entry) => entry.type === 'file') ?? [];

    return (
        <View style={styles.container}>
            <View style={styles.toolbar}>
                <BubblePressable
                    accessibilityRole="button"
                    accessibilityLabel={t("uiCopy.browseFilesystemRoot")}
                    onPress={() => setCurrentDirectory(root)}
                    style={styles.iconButton}
                >
                    <Ionicons name="server-outline" size={17} color={theme.colors.textSecondary} />
                </BubblePressable>
                <BubblePressable
                    accessibilityRole="button"
                    accessibilityLabel={t("uiCopy.browseParentFolder")}
                    onPress={() => setCurrentDirectory(parentHostPath(currentDirectory, platform))}
                    style={styles.iconButton}
                >
                    <Ionicons name="arrow-up" size={17} color={theme.colors.textSecondary} />
                </BubblePressable>
                <Text style={[styles.currentPath, { color: theme.colors.text }]} numberOfLines={1}>
                    {formatPathRelativeToHome(currentDirectory, homeDir)}
                </Text>
                <BubblePressable
                    accessibilityRole="button"
                    accessibilityLabel={isFavorite ? t('uiCopy.removeWorkspaceFavorite') : t('uiCopy.addWorkspaceFavorite')}
                    onPress={() => onToggleFavorite(currentDirectory)}
                    style={styles.iconButton}
                >
                    <Ionicons
                        name={isFavorite ? 'star' : 'star-outline'}
                        size={17}
                        color={isFavorite ? theme.colors.text : theme.colors.textSecondary}
                    />
                </BubblePressable>
                <BubblePressable
                    accessibilityRole="button"
                    accessibilityLabel={t("uiCopy.refreshFolder")}
                    onPress={() => void load()}
                    style={styles.iconButton}
                >
                    <Ionicons name="refresh" size={17} color={theme.colors.textSecondary} />
                </BubblePressable>
            </View>

            <BubblePressable
                accessibilityRole="button"
                accessibilityLabel={t("uiCopy.useValueAsWorkspace", { value1: currentDirectory })}
                onPress={() => {
                    onSelectPath(currentDirectory);
                    onDone?.();
                }}
                style={[styles.useFolderButton, { borderColor: theme.colors.divider }]}
            >
                <Ionicons name="checkmark-circle-outline" size={17} color={theme.colors.text} />
                <Text style={[styles.useFolderText, { color: theme.colors.text }]}>{t("uiCopy.useThisFolder")}</Text>
            </BubblePressable>

            {favorites.length > 0 && (
                <View style={styles.favoriteSection}>
                    <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>{t("workspace.favorites")}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.favoriteRow}>
                        {favorites.filter((favorite) => favorite.machineId === machineId).map((favorite) => (
                            <BubblePressable
                                key={favorite.path}
                                accessibilityRole="button"
                                accessibilityLabel={t("uiCopy.useFavoriteValue", { value1: favorite.path })}
                                onPress={() => {
                                    onSelectPath(favorite.path);
                                    onDone?.();
                                }}
                                style={[styles.favoriteChip, { borderColor: theme.colors.divider }]}
                            >
                                <Ionicons name="star" size={13} color={theme.colors.textSecondary} />
                                <Text style={[styles.favoriteText, { color: theme.colors.text }]} numberOfLines={1}>
                                    {formatPathRelativeToHome(favorite.path, homeDir)}
                                </Text>
                            </BubblePressable>
                        ))}
                    </ScrollView>
                </View>
            )}

            <View style={styles.listHeader}>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>{t("uiCopy.hostFolders")}</Text>
                {loading && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
            </View>
            {error ? (
                <View style={styles.messageRow}>
                    <Ionicons name="warning-outline" size={16} color={theme.colors.textSecondary} />
                    <Text style={[styles.messageText, { color: theme.colors.textSecondary }]}>{error}</Text>
                </View>
            ) : (
                <ScrollView style={styles.treeList} keyboardShouldPersistTaps="handled">
                    {directories.map((entry) => (
                        <BubblePressable
                            key={entry.path}
                            accessibilityRole="button"
                            accessibilityLabel={t("uiCopy.openFolderValue", { value1: entry.name })}
                            onPress={() => setCurrentDirectory(entry.path)}
                            style={styles.treeRow}
                        >
                            <Ionicons name="folder-outline" size={17} color={theme.colors.textSecondary} />
                            <Text style={[styles.treeName, { color: theme.colors.text }]} numberOfLines={1}>{entry.name}</Text>
                            <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
                        </BubblePressable>
                    ))}
                    {files.map((entry) => (
                        <View key={entry.path} style={[styles.treeRow, styles.fileRow]}>
                            <Ionicons name="document-outline" size={16} color={theme.colors.textSecondary} />
                            <Text style={[styles.treeName, { color: theme.colors.textSecondary }]} numberOfLines={1}>{entry.name}</Text>
                        </View>
                    ))}
                    {!loading && directories.length === 0 && files.length === 0 && (
                        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{t("uiCopy.folderIsEmpty")}</Text>
                    )}
                </ScrollView>
            )}
            {selectedPath && selectedPath !== currentDirectory && (
                <Text style={[styles.selectedHint, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {t("uiCopy.selected")} {formatPathRelativeToHome(selectedPath, homeDir)}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: 8, minHeight: 220 },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    currentPath: { flex: 1, fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
    useFolderButton: { minHeight: 38, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    useFolderText: { fontSize: 16, fontWeight: '600' },
    favoriteSection: { gap: 5 },
    favoriteRow: { gap: 6, paddingRight: 8 },
    favoriteChip: { maxWidth: 180, minHeight: 30, paddingHorizontal: 9, borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
    favoriteText: { fontSize: 16, flexShrink: 1 },
    sectionLabel: { fontSize: 16, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
    listHeader: { minHeight: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    treeList: { maxHeight: 260 },
    treeRow: { minHeight: 38, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8 },
    fileRow: { opacity: 0.68 },
    treeName: { flex: 1, fontSize: 16 },
    messageRow: { minHeight: 80, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, padding: 16 },
    messageText: { fontSize: 16, flexShrink: 1 },
    emptyText: { textAlign: 'center', padding: 18, fontSize: 16 },
    selectedHint: { fontSize: 16, paddingTop: 2 },
});
