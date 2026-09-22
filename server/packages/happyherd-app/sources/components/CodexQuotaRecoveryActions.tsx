import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { CodexQuotaRecoveryContext } from '@/utils/codexQuotaRecovery';

export function CodexQuotaRecoveryActions({ sessionId, machineId }: {
    sessionId: string;
    machineId?: string;
}) {
    const router = useRouter();
    const openCredentials = (action: CodexQuotaRecoveryContext['action']) => {
        router.push({
            pathname: '/settings/credentials',
            params: { quotaRecovery: action, sessionId, ...(machineId ? { machineId } : {}) },
        });
    };
    return (
        <View style={styles.actions}>
            <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => openCredentials('connect-account')}
            >
                <Text style={styles.label}>{t('message.codexQuotaRecovery.connectAccount')}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => openCredentials('add-api-key')}
            >
                <Text style={styles.label}>{t('message.codexQuotaRecovery.addApiKey')}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
    button: {
        minHeight: 44,
        maxWidth: '100%',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.surface,
    },
    label: { ...Typography.default(), color: theme.colors.textLink, fontSize: 16, textAlign: 'center' },
}));
