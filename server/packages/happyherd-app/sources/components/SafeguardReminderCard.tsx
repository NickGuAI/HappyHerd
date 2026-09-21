import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { SafeguardReminder } from './safeguardReminder';

export function SafeguardReminderCard({ reminder }: { reminder: SafeguardReminder }) {
    const { theme } = useUnistyles();
    const revise = reminder.status === 'revise';
    const color = revise ? theme.colors.box.warning.text : theme.colors.diff.success;

    return (
        <View
            testID={`safeguard-reminder-${reminder.status}`}
            style={[styles.card, revise ? styles.revise : styles.ready]}
        >
            <View style={styles.header}>
                <Ionicons
                    name={revise ? 'warning-outline' : 'checkmark-circle-outline'}
                    size={20}
                    color={color}
                    accessible={false}
                />
                <Text style={[styles.title, { color }]}>
                    {revise ? t('message.safeguard.revise') : t('message.safeguard.ready')}
                </Text>
            </View>
            {reminder.status === 'ready' ? (
                <Text selectable style={[styles.body, { color }]}>{reminder.summary}</Text>
            ) : reminder.issues.map((issue, index) => (
                <View key={index} style={styles.issue}>
                    <Text selectable style={[styles.quote, { color }]}>{issue.quote}</Text>
                    <Text selectable style={[styles.body, { color }]}>{issue.suggestion}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    card: {
        alignSelf: 'stretch',
        borderWidth: 1,
        borderRadius: theme.borderRadius.md,
        padding: 12,
        marginBottom: 12,
        gap: 8,
    },
    revise: {
        backgroundColor: theme.colors.box.warning.background,
        borderColor: theme.colors.box.warning.border,
    },
    ready: {
        backgroundColor: theme.colors.diff.addedBg,
        borderColor: theme.colors.diff.addedBorder,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: {
        ...Typography.default('semiBold'),
        flex: 1,
        fontSize: 16,
        lineHeight: 22,
    },
    issue: { gap: 4 },
    quote: {
        ...Typography.mono(),
        fontSize: 14,
        lineHeight: 20,
    },
    body: {
        fontSize: 16,
        lineHeight: 22,
    },
}));
