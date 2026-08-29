import React from 'react';
import {
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useHasArchivedSessions, useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useIsTablet } from '@/utils/responsive';
import {
    type SessionListViewItem,
    useAllMachines,
    useSetting,
    useSettingMutable,
} from '@/sync/storage';
import { filterProjectGroupSessions } from '@/sync/projectGroups';
import { t } from '@/text';
import {
    buildFlatSessionRows,
    sessionMatchesFlatListSearch,
    toFlatSessionRow,
    type FlatSessionRowData,
} from '@/utils/flatSessionList';
import { buildSessionProjectDisplayGroups } from '@/utils/sessionDisplayOrder';
import { requestReview } from '@/utils/requestReview';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { FlatSessionRow, flatListBackgroundColor } from './FlatSessionRow';
import { ProjectGroup } from './ProjectGroup';
import { UpdateBanner } from './UpdateBanner';
import { layout } from './layout';

type SessionListDisplayItem = SessionListViewItem | {
    type: 'machine-header';
    machineId: string | null;
    machineName: string;
} | {
    type: 'archive-toggle';
    hidden: boolean;
} | {
    type: 'archive-header';
    title: string;
} | {
    type: 'flat-session';
    row: FlatSessionRowData;
    last: boolean;
    archived?: boolean;
};

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    containerFlat: {
        backgroundColor: flatListBackgroundColor(theme),
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    archiveHeader: {
        backgroundColor: flatListBackgroundColor(theme),
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 8,
    },
    archiveToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 8,
        backgroundColor: flatListBackgroundColor(theme),
    },
    archiveTogglePressed: {
        opacity: 0.5,
    },
    archiveToggleLine: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    archiveToggleText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    machineHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 8,
        paddingBottom: 0,
    },
    machineHeaderLine: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    machineHeaderText: {
        maxWidth: '60%',
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginRight: 4,
        ...Typography.default('regular'),
    },
    phoneUpdateBanner: {
        paddingBottom: 16,
    },
    phoneUpdateBannerHeader: {
        paddingTop: 4,
    },
}));

const MachineHeader = React.memo(({ machineId, machineName }: {
    machineId: string | null;
    machineName: string;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();

    return (
        <Pressable
            onPress={() => machineId && router.navigate(`/machine/${machineId}` as any)}
            disabled={!machineId}
            accessibilityRole={machineId ? 'button' : undefined}
            style={styles.machineHeader}
            hitSlop={{ top: 8, bottom: 8 }}
        >
            <View style={styles.machineHeaderLine} />
            <Ionicons
                name="desktop-outline"
                size={11}
                color={theme.colors.textSecondary}
                style={{ marginHorizontal: 6 }}
            />
            <Text style={styles.machineHeaderText} numberOfLines={1}>
                {machineName}
            </Text>
            <View style={styles.machineHeaderLine} />
        </Pressable>
    );
});

export function SessionsList({
    topContentInset = 0,
    scrollIndicatorTopInset = 0,
    bottomContentInset = 128,
    onScroll,
    searchQuery = '',
}: {
    topContentInset?: number;
    scrollIndicatorTopInset?: number;
    bottomContentInset?: number;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    searchQuery?: string;
} = {}) {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const sourceData = useVisibleSessionListViewData();
    const hasArchivedSessions = useHasArchivedSessions();
    const [hideArchivedSessions, setHideArchivedSessions] = useSettingMutable('hideInactiveSessions');
    const flatSessionList = useSetting('sessionListGrouping') !== 'project';
    const machines = useAllMachines();
    const pathname = usePathname();
    const isTablet = useIsTablet();
    const selectedSessionId = React.useMemo<string | undefined>(() => {
        if (!isTablet || !pathname.startsWith('/session/')) return undefined;
        return pathname.split('/')[2];
    }, [isTablet, pathname]);

    React.useEffect(() => {
        if (sourceData && sourceData.length > 0) requestReview();
    }, [sourceData && sourceData.length > 0]);

    const data = React.useMemo<SessionListDisplayItem[] | null>(() => {
        if (!sourceData) return sourceData;

        const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
        const matchesSession = (session: FlatSessionRowData['session']) => (
            !normalizedQuery || sessionMatchesFlatListSearch(session, normalizedQuery)
        );
        const primaryRows = sourceData.flatMap<SessionListViewItem>((item) => {
            if (item.type === 'header' || item.type === 'session') return [];
            if (item.type === 'active-sessions') {
                const sessions = item.sessions.filter(matchesSession);
                return sessions.length > 0 ? [{ ...item, sessions }] : [];
            }
            if (item.type === 'project') {
                const project = filterProjectGroupSessions(item.project, matchesSession);
                return project ? [{ ...item, project }] : [];
            }
            return [item];
        });

        const archiveItems: SessionListDisplayItem[] = [];
        if (!hideArchivedSessions) {
            let pendingHeader: string | null = null;
            for (const item of sourceData) {
                if (item.type === 'header') {
                    pendingHeader = item.title;
                    continue;
                }
                if (item.type !== 'session' || !matchesSession(item.session)) continue;
                if (pendingHeader) {
                    archiveItems.push({ type: 'archive-header', title: pendingHeader });
                    pendingHeader = null;
                }
                archiveItems.push({
                    type: 'flat-session',
                    row: toFlatSessionRow(item.session),
                    last: false,
                    archived: true,
                });
            }
            for (let index = archiveItems.length - 1; index >= 0; index -= 1) {
                const item = archiveItems[index];
                if (item.type === 'flat-session') {
                    item.last = true;
                    break;
                }
            }
        }

        const archiveToggle: SessionListDisplayItem[] = hasArchivedSessions
            ? [{ type: 'archive-toggle', hidden: hideArchivedSessions }]
            : [];

        if (flatSessionList) {
            const flatRows = buildFlatSessionRows(primaryRows);
            return [
                ...flatRows.map<SessionListDisplayItem>((row, index) => ({
                    type: 'flat-session',
                    row,
                    last: index === flatRows.length - 1,
                })),
                ...archiveToggle,
                ...archiveItems,
            ];
        }

        const machineGroups = buildSessionProjectDisplayGroups(
            primaryRows,
            machines,
            t('status.unknown'),
        );
        const hierarchy = machineGroups.flatMap<SessionListDisplayItem>((group) => [
            {
                type: 'machine-header',
                machineId: group.machineId,
                machineName: group.machineName,
            },
            ...group.projects,
        ]);
        const legacyItems = primaryRows.filter((item) => (
            item.type !== 'project' && item.type !== 'projects-header'
        ));
        return [...hierarchy, ...legacyItems, ...archiveToggle, ...archiveItems];
    }, [flatSessionList, hasArchivedSessions, hideArchivedSessions, machines, searchQuery, sourceData]);

    if (!data) {
        return <View style={[styles.container, flatSessionList && styles.containerFlat]} />;
    }

    const keyExtractor = React.useCallback((item: SessionListDisplayItem, index: number) => {
        switch (item.type) {
            case 'machine-header': return `machine-header-${item.machineId ?? 'unknown'}`;
            case 'archive-toggle': return 'archive-toggle';
            case 'archive-header': return `archive-header-${item.title}-${index}`;
            case 'flat-session': return `flat-session-${item.row.session.id}`;
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'projects-header': return `projects-header-${item.source}`;
            case 'project': return `project-${item.source}-${item.project.machineId ?? 'unknown'}-${item.project.id}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item }: { item: SessionListDisplayItem }) => {
        switch (item.type) {
            case 'machine-header':
                return <MachineHeader machineId={item.machineId} machineName={item.machineName} />;
            case 'flat-session':
                return (
                    <FlatSessionRow
                        row={item.row}
                        selected={item.row.session.id === selectedSessionId}
                        showBorder={!item.last}
                        archived={item.archived}
                    />
                );
            case 'archive-toggle':
                return (
                    <Pressable
                        onPress={() => setHideArchivedSessions(!item.hidden)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: !item.hidden }}
                        style={({ pressed }) => [
                            styles.archiveToggle,
                            pressed && styles.archiveTogglePressed,
                        ]}
                    >
                        <View style={styles.archiveToggleLine} />
                        <Text style={styles.archiveToggleText}>
                            {item.hidden ? t('sidebar.showArchived') : t('sidebar.hideArchived')}
                        </Text>
                        <View style={styles.archiveToggleLine} />
                    </Pressable>
                );
            case 'archive-header':
            case 'header':
                return (
                    <View style={styles.archiveHeader}>
                        <Text style={styles.headerText}>{item.title}</Text>
                    </View>
                );
            case 'active-sessions':
                return (
                    <ActiveSessionsGroupCompact
                        sessions={item.sessions}
                        selectedSessionId={selectedSessionId}
                    />
                );
            case 'project':
                return (
                    <ProjectGroup
                        project={item.project}
                        selectedSessionId={selectedSessionId}
                    />
                );
            case 'project-group':
            case 'projects-header':
            case 'session':
                return null;
        }
    }, [selectedSessionId, setHideArchivedSessions]);

    const HeaderComponent = React.useCallback(() => {
        const isPhoneLayout = topContentInset > 0;
        return (
            <UpdateBanner
                style={isPhoneLayout ? styles.phoneUpdateBanner : undefined}
                headerStyle={isPhoneLayout ? styles.phoneUpdateBannerHeader : undefined}
            />
        );
    }, [styles.phoneUpdateBanner, styles.phoneUpdateBannerHeader, topContentInset]);

    return (
        <View style={[styles.container, flatSessionList && styles.containerFlat]}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={data}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    extraData={selectedSessionId}
                    contentContainerStyle={{
                        paddingTop: topContentInset,
                        paddingBottom: safeArea.bottom + bottomContentInset,
                        maxWidth: layout.maxWidth,
                    }}
                    ListHeaderComponent={HeaderComponent}
                    ListEmptyComponent={searchQuery.trim() ? (
                        <View style={{ paddingTop: 48, alignItems: 'center' }}>
                            <Text style={styles.headerText}>{t('sessionHistory.empty')}</Text>
                        </View>
                    ) : null}
                    automaticallyAdjustsScrollIndicatorInsets={scrollIndicatorTopInset === 0}
                    scrollIndicatorInsets={scrollIndicatorTopInset > 0
                        ? { top: scrollIndicatorTopInset }
                        : undefined}
                    windowSize={5}
                    maxToRenderPerBatch={8}
                    initialNumToRender={12}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                />
            </View>
        </View>
    );
}
