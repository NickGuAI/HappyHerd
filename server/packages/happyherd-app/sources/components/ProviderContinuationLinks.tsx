import { Text } from '@/components/StyledText';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useProviderContinuationSessions, useSession } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { getProviderContinuationLabel, getProviderContinuationSource } from '@/utils/providerContinuation';
import { herdAlpha } from './herd/session/color';
import { herdWebClasses } from './herd/motion';

export const ProviderContinuationLinks = React.memo(function ProviderContinuationLinks({
    session,
}: {
    session: Session;
}) {
    const navigateToSession = useNavigateToSession();
    const source = useSession(session.metadata?.continuedFromSessionId ?? '');
    const targets = useProviderContinuationSessions(session.id);
    const newestTarget = targets[0] ?? null;

    if (!source && !newestTarget) return null;

    return (
        <View style={styles.container}>
            {source && (
                <ContinuationLink
                    icon="return-up-back-outline"
                    label={t('session.providerContinuationFrom', { provider: providerLabel(source) })}
                    onPress={() => navigateToSession(source.id)}
                />
            )}
            {newestTarget && (
                <ContinuationLink
                    icon="arrow-forward-outline"
                    label={t('session.providerContinuationTo', { provider: providerLabel(newestTarget) })}
                    onPress={() => navigateToSession(newestTarget.id)}
                />
            )}
        </View>
    );
});

function ContinuationLink({
    icon,
    label,
    onPress,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={({ pressed, hovered }: any) => [
                styles.link,
                hovered && styles.hovered,
                pressed && styles.pressed,
            ]}
        >
            <Ionicons name={icon} size={Platform.OS === 'web' ? 13 : 15} color={theme.colors.textLink} />
            <Text numberOfLines={1} style={styles.label}>{label}</Text>
        </Pressable>
    );
}

function providerLabel(session: Session): string {
    const provider = getProviderContinuationSource(session.metadata?.flavor);
    return provider
        ? getProviderContinuationLabel(provider)
        : session.metadata?.flavor ?? '';
}

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
        paddingBottom: 6,
        paddingHorizontal: 8,
    },
    // Web continuation links are molten pills (UI overhaul).
    link: {
        alignItems: 'center',
        backgroundColor: Platform.select({ web: theme.colors.selection.background, default: theme.colors.surfaceHigh }),
        borderRadius: theme.kilv.radiusPill,
        borderWidth: Platform.select({ web: 1, default: 0 }),
        borderColor: herdAlpha(theme.colors.textLink, 0.35),
        flexDirection: 'row',
        gap: Platform.select({ web: 7, default: 6 }),
        maxWidth: '100%',
        minHeight: Platform.select({ web: 28, default: 32 }),
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ web: 4, default: 6 }),
        _web: {
            _classNames: herdWebClasses('herd-rise-sm', 'herd-transition'),
        },
    },
    label: {
        color: theme.colors.textLink,
        fontSize: Platform.select({ web: 12.5, default: 13 }),
        fontWeight: '500' as const,
    },
    hovered: {
        backgroundColor: herdAlpha(theme.colors.textLink, 0.14),
        borderColor: herdAlpha(theme.colors.textLink, 0.55),
    },
    pressed: {
        opacity: 0.7,
    },
}));
