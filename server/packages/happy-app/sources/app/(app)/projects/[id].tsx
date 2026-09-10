import React from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FlatSessionRow, flatListBackgroundColor } from '@/components/FlatSessionRow';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Text } from '@/components/StyledText';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useProjects, useSessionListViewData } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { buildProjectSessionList } from '@/utils/projectSessionList';

const projectText = t as (key: string, params?: Record<string, string | number>) => string;

export default React.memo(function ProjectSessionsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const projects = useProjects();
    const sourceData = useSessionListViewData();
    const project = projects[id];
    const [renaming, setRenaming] = React.useState(false);
    const [showArchived, setShowArchived] = React.useState(false);
    const list = React.useMemo(() => buildProjectSessionList(sourceData ?? [], id), [sourceData, id]);

    React.useEffect(() => setShowArchived(false), [id]);

    const renameProject = React.useCallback(async () => {
        if (!project || renaming) return;
        const name = await Modal.prompt(
            projectText('projects.renameTitle'),
            projectText('projects.renamePrompt', { name: project.name }),
            { defaultValue: project.name, confirmText: t('common.rename') },
        );
        if (!name?.trim() || name.trim() === project.name) return;
        setRenaming(true);
        try {
            await sync.renameProject(project.id, name);
        } catch {
            Modal.alert(t('common.error'), t('happyHerd.automations.unknownError'));
        } finally {
            setRenaming(false);
        }
    }, [project, renaming]);

    const title = project?.kind === 'personal' ? project.name : t('sidebar.projects');
    const sessionCount = list.sessions.length + list.archivedSessions.length;
    return (
        <View style={styles.container} testID="project-detail-screen">
            <Stack.Screen options={{ headerTitle: title }} />
            <View style={styles.content}>
                {sourceData === null ? (
                    <View style={styles.state} testID="project-detail-loading">
                        <ActivityIndicator color={theme.colors.textSecondary} />
                    </View>
                ) : !project || project.kind !== 'personal' ? (
                    <View style={styles.state}>
                        <Text style={styles.stateText} testID="project-detail-state">
                            {projectText('projects.notFound')}
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        testID="project-session-list"
                        data={list.sessions}
                        keyExtractor={(row) => row.session.id}
                        contentContainerStyle={{ paddingBottom: safeArea.bottom + 16 }}
                        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                        ListHeaderComponent={(
                            <ItemGroup title={projectText('projects.sessionCount', { count: sessionCount })}>
                                <Item
                                    title={projectText('projects.rename')}
                                    icon={<Ionicons name="pencil-outline" size={24} color={theme.colors.textLink} />}
                                    loading={renaming}
                                    disabled={renaming}
                                    showChevron={false}
                                    onPress={renameProject}
                                />
                            </ItemGroup>
                        )}
                        renderItem={({ item, index }) => (
                            <View testID={`project-session-row-${item.session.id}`}>
                                <FlatSessionRow
                                    row={item}
                                    pinned={item.session.id === list.superSessionId}
                                    showBorder={index < list.sessions.length - 1}
                                />
                            </View>
                        )}
                        ListEmptyComponent={sessionCount === 0 ? (
                            <View style={styles.state}>
                                <Text style={styles.stateText} testID="project-detail-state">
                                    {projectText('projects.sessionsEmpty')}
                                </Text>
                            </View>
                        ) : null}
                        ListFooterComponent={list.archivedSessions.length > 0 ? (
                            <View>
                                <Pressable
                                    testID="project-archive-toggle"
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded: showArchived }}
                                    onPress={() => setShowArchived((value) => !value)}
                                    style={({ pressed }) => [styles.archiveToggle, pressed && styles.pressed]}
                                >
                                    <Ionicons name="archive-outline" size={20} color={theme.colors.textSecondary} />
                                    <Text style={styles.archiveText}>
                                        {showArchived ? t('sidebar.hideArchived') : t('sidebar.showArchived')}
                                    </Text>
                                </Pressable>
                                {showArchived && list.archivedSessions.map((row, index) => (
                                    <View key={row.session.id} testID={`project-session-row-${row.session.id}`}>
                                        <FlatSessionRow
                                            row={row}
                                            archived
                                            showBorder={index < list.archivedSessions.length - 1}
                                        />
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    />
                )}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: flatListBackgroundColor(theme),
    },
    content: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
    },
    state: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    stateText: {
        color: theme.colors.textSecondary,
        fontSize: 16,
        textAlign: 'center',
        ...Typography.default(),
    },
    archiveToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 20,
        gap: 12,
    },
    archiveText: {
        color: theme.colors.textSecondary,
        fontSize: 16,
        ...Typography.default(),
    },
    pressed: {
        opacity: 0.5,
    },
}));
