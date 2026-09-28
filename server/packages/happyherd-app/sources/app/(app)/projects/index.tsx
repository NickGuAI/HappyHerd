import React from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { SessionStatusAvatar } from '@/components/SessionStatusAvatar';
import { Text } from '@/components/StyledText';
import {
    HerdButton,
    HerdEmptyState,
    HerdPageHeader,
    useHerdWideLayout,
} from '@/components/herd/pages/HerdPage';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';
import { Typography } from '@/constants/Typography';
import { useFocusMode } from '@/hooks/useFocusMode';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { getSessionProjectId } from '@/sync/projectTypes';
import { useAllSessions, useProjects, useSessionListViewData } from '@/sync/storage';
import { t } from '@/text';
import type { FlatSessionRowData } from '@/utils/flatSessionList';
import { buildProjectSessionList } from '@/utils/projectSessionList';

const projectText = t as (key: string, params?: Record<string, string | number>) => string;

const CARD_MIN_WIDTH = 260;
const CARD_GAP = 14;
const AVATAR_STACK_SIZE = 5;

function AvatarStack({ rows }: { rows: FlatSessionRowData[] }) {
    if (rows.length === 0) return null;
    return (
        <View style={styles.stack}>
            {rows.map(({ session }, index) => (
                <View key={session.id} style={[styles.stackItem, index > 0 && styles.stackOverlap]}>
                    <SessionStatusAvatar
                        imageUrl={session.sessionAvatarUri}
                        thumbhash={session.sessionAvatarThumbhash}
                        active={session.active}
                        botId={session.botId}
                        botName={session.name}
                        clientId={session.clientId}
                        commanderId={session.commanderId}
                        commanderName={session.commanderName}
                        flavor={session.flavor}
                        hasDraft={session.hasDraft}
                        hasUnread={false}
                        machineId={session.machineId}
                        machineOffline={session.machineOffline}
                        providerKind={session.providerKind}
                        providerLabel={session.identityLine}
                        size={28}
                        state={session.state}
                    />
                </View>
            ))}
        </View>
    );
}

export default function ProjectsScreen() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const wide = useHerdWideLayout();
    const projectsById = useProjects();
    const sessions = useAllSessions();
    const sessionListData = useSessionListViewData();
    const focus = useFocusMode();
    const [busyProjectId, setBusyProjectId] = React.useState<string | null>(null);
    const [gridWidth, setGridWidth] = React.useState(0);
    const projects = React.useMemo(() => (
        Object.values(projectsById)
            .filter((project) => project.kind === 'personal')
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    ), [projectsById]);
    const sessionCounts = React.useMemo(() => {
        const counts = new Map<string, number>();
        for (const session of sessions) {
            const projectId = getSessionProjectId(session);
            if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
        }
        return counts;
    }, [sessions]);
    const recentRows = React.useMemo(() => new Map(projects.map((project) => [
        project.id,
        buildProjectSessionList(sessionListData ?? [], project.id).sessions.slice(0, AVATAR_STACK_SIZE),
    ])), [projects, sessionListData]);
    const columns = Math.max(1, Math.floor((gridWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
    const cardWidth = gridWidth > 0 && columns > 1
        ? Math.floor((gridWidth - CARD_GAP * (columns - 1)) / columns)
        : undefined;
    const onGridLayout = React.useCallback((event: LayoutChangeEvent) => {
        setGridWidth(event.nativeEvent.layout.width);
    }, []);

    const createProject = React.useCallback(async () => {
        const name = await Modal.prompt(
            projectText('projects.createTitle'),
            projectText('projects.createPrompt'),
            { confirmText: projectText('projects.create') },
        );
        if (!name?.trim()) return;
        setBusyProjectId('create');
        try {
            await sync.createProject(name);
        } catch {
            Modal.alert(t('common.error'), t('happyHerd.automations.unknownError'));
        } finally {
            setBusyProjectId(null);
        }
    }, []);

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, !wide && styles.contentCompact]}
        >
            {/* Wide layouts draw the mock's large title in the page, so the header bar steps aside. */}
            <Stack.Screen options={{ headerShown: !wide }} />
            <HerdPageHeader
                testID="projects-page-header"
                compact={!wide}
                title={wide ? t('sidebar.projects') : undefined}
                subtitle={projectText('projects.emptyDescription')}
                actions={(
                    <HerdButton
                        variant="primary"
                        icon="add"
                        label={projectText('projects.create')}
                        loading={busyProjectId === 'create'}
                        disabled={busyProjectId !== null}
                        onPress={createProject}
                    />
                )}
            />
            {projects.length === 0 ? (
                <HerdEmptyState testID="projects-empty" icon="folder-open-outline" />
            ) : (
                <View testID="projects-grid" onLayout={onGridLayout} style={styles.grid}>
                    {projects.map((project, index) => {
                        const count = sessionCounts.get(project.id) ?? 0;
                        const focused = focus?.projectId === project.id;
                        return (
                            <Pressable
                                key={project.id}
                                testID={`project-card-${project.id}`}
                                accessibilityRole="button"
                                accessibilityLabel={project.name}
                                disabled={busyProjectId !== null}
                                onPress={() => router.push(`/projects/${encodeURIComponent(project.id)}` as any)}
                                style={({ pressed }) => [
                                    styles.card(index),
                                    cardWidth ? { width: cardWidth } : styles.cardFull,
                                    focused && styles.cardFocused,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <View style={styles.cardTitle}>
                                    <Ionicons name="folder-outline" size={18} color={theme.colors.textLink} />
                                    <Text style={styles.name} numberOfLines={2}>{project.name}</Text>
                                    {focused ? (
                                        <View style={styles.focusTag}>
                                            <Text style={styles.focusTagText}>{t('focusMode.enter')}</Text>
                                        </View>
                                    ) : null}
                                </View>
                                <Text style={styles.count}>{projectText('projects.sessionCount', { count })}</Text>
                                <AvatarStack rows={recentRows.get(project.id) ?? []} />
                            </Pressable>
                        );
                    })}
                    {/* The mock ends the grid with a dashed tile that creates a project, like the header button. */}
                    <Pressable
                        testID="projects-create-tile"
                        accessibilityRole="button"
                        accessibilityLabel={projectText('projects.create')}
                        disabled={busyProjectId !== null}
                        onPress={createProject}
                        style={({ pressed }) => [
                            styles.createTile(projects.length),
                            cardWidth ? { width: cardWidth } : styles.cardFull,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Ionicons name="add" size={18} color={theme.colors.textLink} />
                        <Text style={styles.createTileText}>{projectText('projects.create')}</Text>
                    </Pressable>
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    scroll: { flex: 1 },
    content: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 34, paddingTop: 28, paddingBottom: 80 },
    // Phones (UI overhaul): the page content sits on the 16 px gutter.
    contentCompact: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 48 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP },
    // The only style in a card's list that sets web classes (Unistyles merges `_web` key by key).
    card: (index: number) => ({
        minHeight: 132,
        paddingHorizontal: 18,
        paddingVertical: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surface,
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-rise-sm', herdStaggerClass(index)),
            cursor: 'pointer',
            _hover: { borderColor: theme.colors.kilv.rimLine, transform: 'translateY(-2px)', boxShadow: theme.kilv.shadow },
        },
    }),
    cardFull: { width: '100%' },
    // The only style in the tile's list that sets web classes, as for the cards.
    createTile: (index: number) => ({
        minHeight: 132,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: 'transparent',
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-rise-sm', herdStaggerClass(index)),
            cursor: 'pointer',
            _hover: { borderColor: theme.colors.kilv.rimLine },
        },
    }),
    createTileText: { ...Typography.default('semiBold'), fontSize: 15, color: theme.colors.textLink },
    cardFocused: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.colors.selection.ring },
    },
    cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { ...Typography.default('semiBold'), flex: 1, minWidth: 0, fontSize: 18, lineHeight: 24, color: theme.colors.text },
    focusTag: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: theme.colors.selection.border,
        borderRadius: theme.borderRadius.sm,
    },
    focusTagText: { ...Typography.mono(), fontSize: 11, color: theme.colors.textLink },
    count: { ...Typography.mono(), fontSize: 12.5, color: theme.colors.textSecondary },
    stack: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    stackItem: {
        borderRadius: theme.kilv.radiusPill,
        borderWidth: 2,
        borderColor: theme.colors.surface,
    },
    stackOverlap: { marginLeft: -8 },
    pressed: { opacity: 0.85 },
}));
