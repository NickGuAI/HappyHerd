import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useProviderContinuationSessions, useSession } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { getProviderContinuationLabel, getProviderContinuationSource } from '@/utils/providerContinuation';

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
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
            <Ionicons name={icon} size={15} color={theme.colors.textLink} />
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
    link: {
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 999,
        flexDirection: 'row',
        gap: 6,
        maxWidth: '100%',
        minHeight: 32,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    label: {
        color: theme.colors.textLink,
        fontSize: 13,
        fontWeight: '500' as const,
    },
    pressed: {
        opacity: 0.7,
    },
}));
