import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@slopus/happy-wire';

import { Text as StyledText } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { happyHerdAutomationCardPresentation } from './happyHerdAutomationCardPresentation';

function Text(props: React.ComponentProps<typeof StyledText>) {
    const { theme } = useUnistyles();
    return <StyledText {...props} style={[{ color: theme.colors.text }, props.style]} />;
}

export type HappyHerdAutomationCardProps = {
    automation: HappyHerdAutomation;
    history?: HappyHerdAutomationRun[];
    onToggleStatus: () => void;
    onRunNow: () => void;
    onToggleHistory: () => void;
    onOpenSession: (sessionId: string) => void;
    onEdit: () => void;
    onDelete: () => void;
};

export function HappyHerdAutomationCard({
    automation,
    history,
    onToggleStatus,
    onRunNow,
    onToggleHistory,
    onOpenSession,
    onEdit,
    onDelete,
}: HappyHerdAutomationCardProps) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const presentation = happyHerdAutomationCardPresentation(automation, expanded);
    const statusLabel = t(presentation.statusKey);

    return (
        <View style={[styles.card, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
            <Pressable
                onPress={() => setExpanded((current) => !current)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={t(
                    expanded
                        ? 'happyHerd.automations.collapseDetails'
                        : 'happyHerd.automations.expandDetails',
                    { name: automation.name },
                )}
                style={styles.summary}
            >
                <View style={styles.cardTitleRow}>
                    <View
                        style={[
                            styles.statusDot,
                            { backgroundColor: presentation.active ? '#34C759' : theme.colors.textSecondary },
                        ]}
                    />
                    <Text style={styles.sectionTitle} numberOfLines={2}>{presentation.name}</Text>
                </View>
                <View style={styles.summaryStatus}>
                    <Text style={{ color: theme.colors.textSecondary }}>{statusLabel}</Text>
                    <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                </View>
            </Pressable>

            {presentation.details && (
                <View style={[styles.details, { borderTopColor: theme.colors.divider }]}>
                    <View style={styles.detailHeader}>
                        <Text style={{ flex: 1, color: theme.colors.textSecondary }}>
                            {presentation.details.schedule} · {presentation.details.timezone}
                        </Text>
                        <Text style={[styles.badge, { borderColor: theme.colors.divider }]}>{presentation.details.kind}</Text>
                    </View>
                    <Text>{presentation.details.instruction}</Text>
                    <Text style={{ color: theme.colors.textSecondary }}>
                        {presentation.details.rail} · {presentation.details.workspace}
                        {presentation.details.commanderId
                            ? ` · ${t('happyHerd.automations.commanderValue', { id: presentation.details.commanderId })}`
                            : ''}
                    </Text>
                    {presentation.details.targetSessionId && (
                        <Pressable
                            style={[styles.action, { alignSelf: 'flex-start', borderColor: theme.colors.divider }]}
                            onPress={() => onOpenSession(presentation.details!.targetSessionId!)}
                        >
                            <Text>{t('happyHerd.heartbeat.openTarget')}</Text>
                        </Pressable>
                    )}
                    {presentation.details.tags.length > 0 && (
                        <View style={styles.tags}>
                            {presentation.details.tags.map((tag) => (
                                <Text key={tag} style={[styles.badge, { borderColor: theme.colors.divider }]}>{tag}</Text>
                            ))}
                        </View>
                    )}
                    <View style={styles.actions}>
                        {automation.kind !== 'heartbeat' && <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={onToggleStatus}>
                            <Text>{presentation.active ? t('happyHerd.automations.pause') : t('happyHerd.automations.resume')}</Text>
                        </Pressable>}
                        {automation.kind !== 'heartbeat' && <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={onRunNow}>
                            <Text>{t('happyHerd.automations.runNow')}</Text>
                        </Pressable>}
                        <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={onToggleHistory}>
                            <Text>{t('happyHerd.automations.history')}</Text>
                        </Pressable>
                        {automation.kind !== 'heartbeat' && <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={onEdit}>
                            <Text>{t('happyHerd.automations.editAction')}</Text>
                        </Pressable>}
                        {automation.kind !== 'heartbeat' && <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={onDelete}>
                            <Text style={{ color: theme.colors.status.disconnected }}>{t('happyHerd.automations.delete')}</Text>
                        </Pressable>}
                    </View>
                    {history && (
                        <View style={[styles.history, { borderTopColor: theme.colors.divider }]}>
                            {history.length === 0 ? (
                                <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.automations.noRuns')}</Text>
                            ) : history.map((run) => {
                                const sessionId = run.sessionId;
                                const rowContent = (
                                    <>
                                        <Text style={styles.historyStatus}>{run.status}</Text>
                                        <Text style={{ flex: 1, color: theme.colors.textSecondary }}>
                                            {new Date(run.scheduledFor).toLocaleString()} · {t('happyHerd.automations.attempt', { count: run.attempt })}
                                            {sessionId ? ` · ${sessionId}` : ''}
                                        </Text>
                                    </>
                                );

                                return sessionId ? (
                                    <Pressable
                                        key={run.id}
                                        style={({ pressed }) => [styles.historyRow, styles.historyLink, pressed && styles.historyLinkPressed]}
                                        onPress={() => onOpenSession(sessionId)}
                                        accessibilityRole="link"
                                        accessibilityLabel={t('happyHerd.automations.openSession', { id: sessionId })}
                                    >
                                        {rowContent}
                                        <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                                    </Pressable>
                                ) : (
                                    <View key={run.id} style={styles.historyRow}>{rowContent}</View>
                                );
                            })}
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        overflow: 'hidden',
    },
    summary: {
        minHeight: 60,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    cardTitleRow: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    sectionTitle: { flex: 1, fontSize: 17, ...Typography.default('semiBold') },
    summaryStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    details: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
    },
    detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
        fontSize: 12,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    action: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
    history: { marginTop: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
    historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    historyLink: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 6, marginHorizontal: -6 },
    historyLinkPressed: { opacity: 0.7 },
    historyStatus: { width: 62, ...Typography.default('semiBold') },
}));
