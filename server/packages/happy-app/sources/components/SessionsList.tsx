import React from 'react';
import {
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/StyledText';
import { FlatSessionRow, flatListBackgroundColor } from './FlatSessionRow';
import {
    buildFlatSessionRows,
    sessionMatchesFlatListSearch,
    toFlatSessionRow,
    type FlatSessionRowData,
} from '@/utils/flatSessionList';
import { useHasArchivedSessions, useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useSettingMutable } from '@/sync/storage';
import { Typography } from '@/constants/Typography';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { UpdateBanner } from './UpdateBanner';
import { layout } from './layout';
import { t } from '@/text';

type SessionListDisplayItem = {
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
    phoneUpdateBanner: {
        paddingBottom: 16,
    },
    phoneUpdateBannerHeader: {
        paddingTop: 4,
    },
}));

/**
 * Home has one product shape: a globally ordered decision inbox. The source
 * may still be grouped for sync compatibility, but no grouped/Active variant
 * is rendered and no display-mode setting is read or written here.
 */
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
    // The persisted key predates archive semantics and has no rename migration.
    // This is archive visibility, not a second Home display mode.
    const [hideArchivedSessions, setHideArchivedSessions] = useSettingMutable('hideInactiveSessions');
    const pathname = usePathname();
    const isTablet = useIsTablet();
    const selectedSessionId = React.useMemo<string | undefined>(() => {
        if (!isTablet || !pathname.startsWith('/session/')) return undefined;
        return pathname.split('/')[2];
    }, [isTablet, pathname]);

    React.useEffect(() => {
        if (sourceData && sourceData.length > 0) {
            requestReview();
        }
    }, [sourceData && sourceData.length > 0]);

    const data = React.useMemo<SessionListDisplayItem[] | null>(() => {
        if (!sourceData) return sourceData;

        const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
        const matches = (row: FlatSessionRowData) => (
            !normalizedQuery
            || sessionMatchesFlatListSearch(row.session, normalizedQuery)
        );
        const primaryRows = buildFlatSessionRows(sourceData).filter(matches);
        const items: SessionListDisplayItem[] = primaryRows.map((row, index) => ({
            type: 'flat-session',
            row,
            last: index === primaryRows.length - 1,
        }));

        if (hasArchivedSessions) {
            items.push({ type: 'archive-toggle', hidden: hideArchivedSessions });
        }
        if (hideArchivedSessions) return items;

        // Archived sessions already arrive in deterministic activity order,
        // split by date headings. Hold each heading until one of its rows
        // survives search so the archive never shows an empty date group.
        let pendingHeader: string | null = null;
        const archivedItems: SessionListDisplayItem[] = [];
        for (const item of sourceData) {
            if (item.type === 'header') {
                pendingHeader = item.title;
                continue;
            }
            if (item.type !== 'session') continue;

            const row = toFlatSessionRow(item.session);
            if (!matches(row)) continue;
            if (pendingHeader) {
                archivedItems.push({ type: 'archive-header', title: pendingHeader });
                pendingHeader = null;
            }
            archivedItems.push({
                type: 'flat-session',
                row,
                last: false,
                archived: true,
            });
        }
        for (let index = archivedItems.length - 1; index >= 0; index -= 1) {
            const item = archivedItems[index];
            if (item.type === 'flat-session') {
                item.last = true;
                break;
            }
        }
        return [...items, ...archivedItems];
    }, [hasArchivedSessions, hideArchivedSessions, searchQuery, sourceData]);

    if (!data) {
        return <View style={styles.container} />;
    }

    const keyExtractor = React.useCallback((item: SessionListDisplayItem, index: number) => {
        switch (item.type) {
            case 'archive-toggle': return 'archive-toggle';
            case 'archive-header': return `archive-header-${item.title}-${index}`;
            case 'flat-session': return `flat-session-${item.row.session.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item }: { item: SessionListDisplayItem }) => {
        switch (item.type) {
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
                return (
                    <View style={styles.archiveHeader}>
                        <Text style={styles.headerText}>{item.title}</Text>
                    </View>
                );
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
        <View style={styles.container}>
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
