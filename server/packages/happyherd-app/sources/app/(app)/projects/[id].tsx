import React from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FlatSessionRow, flatListBackgroundColor } from '@/components/FlatSessionRow';
import { Text } from '@/components/StyledText';
import { HerdButton, HerdPageHeader, useHerdWideLayout } from '@/components/herd/pages/HerdPage';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';
import { Typography } from '@/constants/Typography';
import { openFocusSetup } from '@/components/focusSetup';
import { useFocusMode } from '@/hooks/useFocusMode';
import { Modal } from '@/modal';
import { useProjects, useProjectsLoaded, useSessionListViewData } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { buildProjectSessionList } from '@/utils/projectSessionList';

const projectText = t as (key: string, params?: Record<string, string | number>) => string;

export default React.memo(function ProjectSessionsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const wide = useHerdWideLayout();
    const focus = useFocusMode();
    const projects = useProjects();
    const projectsLoaded = useProjectsLoaded();
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

    // Opens the Focus setup preset to this project, as the mock does; the top bar
    // then shows the countdown and its exit.
    const focusOnProject = focus?.projectId === project?.id;
    const startFocus = React.useCallback(() => {
        if (!project) return;
        openFocusSetup({ projectId: project.id });
    }, [project]);

    const projectActions = (
        <>
            <HerdButton
                icon="pencil-outline"
                label={projectText('projects.rename')}
                loading={renaming}
                disabled={renaming}
                onPress={renameProject}
            />
            <HerdButton
                testID="project-focus"
                variant="primary"
                glyph="focus"
                label={t('focusMode.enter')}
                selected={focusOnProject}
                disabled={focusOnProject}
                onPress={startFocus}
            />
        </>
    );

    const title = project?.kind === 'personal' ? project.name : t('sidebar.projects');
    const sessionCount = list.sessions.length + list.archivedSessions.length;
    return (
        <View style={styles.container} testID="project-detail-screen">
            {/* Wide layouts draw the title, Back and count in the page, as the mock does. */}
            <Stack.Screen options={{ headerTitle: title, headerShown: !wide }} />
            <View style={styles.content}>
                {sourceData === null || (!project && !projectsLoaded) ? (
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
                        contentContainerStyle={[
                            styles.listContent,
                            !wide && styles.listContentCompact,
                            { paddingBottom: safeArea.bottom + 32 },
                        ]}
                        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                        ListHeaderComponent={(
                            <View testID="project-page-header">
                                <HerdPageHeader
                                    compact={!wide}
                                    title={wide ? project.name : undefined}
                                    leading={wide ? (
                                        <HerdButton
                                            testID="project-back"
                                            variant="ghost"
                                            icon="arrow-back"
                                            accessibilityLabel={t('common.back')}
                                            onPress={() => router.navigate('/projects' as any)}
                                        />
                                    ) : undefined}
                                    subtitle={projectText('projects.sessionCount', { count: sessionCount })}
                                    subtitleMono={!wide}
                                    actions={wide ? projectActions : undefined}
                                />
                                {/* Phones put the actions on their own row under the count, as the phone mock does. */}
                                {!wide ? <View style={styles.actionsCompact}>{projectActions}</View> : null}
                            </View>
                        )}
                        renderItem={({ item, index }) => (
                            <View
                                testID={`project-session-row-${item.session.id}`}
                                style={[
                                    styles.rowShell(index),
                                    index === 0 && styles.rowShellFirst,
                                    index === list.sessions.length - 1 && styles.rowShellLast,
                                ]}
                            >
                                <FlatSessionRow
                                    row={item}
                                    pinned={item.session.id === list.superSessionId}
                                    entranceIndex={index}
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
                            <View style={styles.archive}>
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
                                    <View
                                        key={row.session.id}
                                        testID={`project-session-row-${row.session.id}`}
                                        style={[
                                            styles.rowShell(index),
                                            index === 0 && styles.rowShellFirst,
                                            index === list.archivedSessions.length - 1 && styles.rowShellLast,
                                        ]}
                                    >
                                        <FlatSessionRow
                                            row={row}
                                            archived
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
        maxWidth: 820,
    },
    listContent: {
        paddingHorizontal: 34,
        paddingTop: 28,
    },
    actionsCompact: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 14,
    },
    listContentCompact: {
        paddingHorizontal: 14,
        paddingTop: 18,
    },
    // Rows sit in one card; the only style in a row's list that sets web classes.
    rowShell: (index: number) => ({
        overflow: 'hidden',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(index)) },
    }),
    rowShellFirst: {
        borderTopWidth: 1,
        borderTopLeftRadius: theme.kilv.radiusCard,
        borderTopRightRadius: theme.kilv.radiusCard,
    },
    rowShellLast: {
        borderBottomWidth: 1,
        borderBottomLeftRadius: theme.kilv.radiusCard,
        borderBottomRightRadius: theme.kilv.radiusCard,
    },
    archive: {
        marginTop: 8,
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
        paddingHorizontal: 8,
        paddingVertical: 16,
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
