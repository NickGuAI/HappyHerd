import * as React from 'react';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { SafeguardReminder } from './safeguardReminder';
import { herdWebClasses } from './herd/motion';

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
                    name={revise ? 'warning-outline' : Platform.OS === 'web' ? 'shield-checkmark-outline' : 'checkmark-circle-outline'}
                    size={Platform.OS === 'web' ? 16 : 20}
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
        paddingVertical: Platform.select({ web: 10, default: 12 }),
        paddingHorizontal: Platform.select({ web: 13, default: 12 }),
        marginBottom: 12,
        gap: Platform.select({ web: 6, default: 8 }),
        _web: {
            _classNames: herdWebClasses('herd-rise-sm'),
        },
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
        fontSize: Platform.select({ web: 14, default: 16 }),
        lineHeight: Platform.select({ web: 20, default: 22 }),
    },
    issue: {
        gap: 4,
        borderLeftWidth: Platform.select({ web: 2, default: 0 }),
        borderLeftColor: theme.colors.box.warning.border,
        paddingLeft: Platform.select({ web: 10, default: 0 }),
    },
    quote: {
        ...Typography.mono(),
        fontSize: Platform.select({ web: 12.5, default: 14 }),
        lineHeight: 20,
    },
    body: {
        fontSize: Platform.select({ web: 14, default: 16 }),
        lineHeight: Platform.select({ web: 20, default: 22 }),
    },
}));
