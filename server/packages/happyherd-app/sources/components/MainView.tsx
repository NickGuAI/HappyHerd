import * as React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { EmptySessionsTablet } from './EmptySessionsTablet';
import { SessionsList } from './SessionsList';

interface MainViewProps {
    variant: 'phone' | 'sidebar';
}

const styles = StyleSheet.create((theme) => ({
    sidebarContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    tabletLoadingContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
}));

/**
 * `sidebar` is the left panel's session list. `phone` is the index route on
 * tablets, where the list lives in the panel and the main area stays blank.
 * Phones render the panel itself as the list (herd/mobile/PhoneHome, UI overhaul).
 */
export const MainView = React.memo(({ variant }: MainViewProps) => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();

    if (variant === 'phone') {
        return <View style={styles.emptyStateContentContainer} />;
    }

    // Loading state
    if (sessionListViewData === null) {
        return (
            <View style={styles.sidebarContentContainer}>
                <View style={styles.tabletLoadingContainer}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            </View>
        );
    }

    // Empty state
    if (sessionListViewData.length === 0) {
        return (
            <View style={styles.sidebarContentContainer}>
                <View style={styles.emptyStateContainer}>
                    <EmptySessionsTablet />
                </View>
            </View>
        );
    }

    // Sessions list
    return (
        <View style={styles.sidebarContentContainer}>
            <SessionsList />
        </View>
    );
});
