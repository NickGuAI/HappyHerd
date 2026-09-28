import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@happyherd/wire';

import { Text as StyledText } from '@/components/StyledText';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import {
    happyHerdAutomationKindLabel,
    happyHerdAutomationRunStatusLabel,
    happyHerdAutomationNextRun,
} from '@/components/happyHerdAutomationPresentation';
import { HerdButton, HerdSectionLabel } from '@/components/herd/pages/HerdPage';
import { herdWebClasses } from '@/components/herd/motion';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

function Text(props: React.ComponentProps<typeof StyledText>) {
    const { theme } = useUnistyles();
    return <StyledText {...props} style={[{ color: theme.colors.text }, props.style]} />;
}

const translateAutomation = (key: any, params?: Record<string, string | number>) => (
    (t as any)(key, params)
);

/** Runs listed before History expands the full list. */
export const HAPPYHERD_AUTOMATION_RECENT_RUNS = 3;

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
            <Text selectable numberOfLines={2} style={[styles.fieldValue, mono && styles.mono]}>
                {value}
            </Text>
        </View>
    );
}

function RunState({ run, fresh }: { run: HappyHerdAutomationRun; fresh: boolean }) {
    const { theme } = useUnistyles();
    if (run.status === 'running' || run.status === 'started') {
        return <ActivityIndicator testID="automation-run-running" size="small" color={theme.colors.textLink} />;
    }
    if (run.status === 'completed') {
        return (
            <View style={fresh ? styles.freshCheck : undefined}>
                <Ionicons testID="automation-run-completed" name="checkmark" size={16} color={theme.colors.diff.success} />
            </View>
        );
    }
    if (run.status === 'failed') {
        return <Ionicons name="alert-circle-outline" size={16} color={theme.colors.status.disconnected} />;
    }
    return <Ionicons name="remove" size={16} color={theme.colors.textSecondary} />;
}

export type HappyHerdAutomationDetailProps = {
    automation: HappyHerdAutomation;
    machineName: string;
    /** Display name for `automation.commanderId` when the machine's Commander list is loaded. */
    commanderName?: string | null;
    history?: HappyHerdAutomationRun[];
    historyLoading: boolean;
    historyFailed: boolean;
    /** The run started from this screen, highlighted until it settles. */
    freshRunId?: string | null;
    onRunNow: () => void;
    onEdit: () => void;
    onToggleStatus: () => void;
    onDelete: () => void;
    onOpenSession: (sessionId: string) => void;
    /** Reloads history: the retry action and the History toggle both use it. */
    onRetryHistory: () => void;
};

/**
 * The expanded body of one automation row (UI overhaul): actions, instructions
 * or command, details, schedule, previous runs and lifecycle.
 */
export function HappyHerdAutomationDetail({
    automation,
    machineName,
    commanderName,
    history,
    historyLoading,
    historyFailed,
    freshRunId = null,
    onRunNow,
    onEdit,
    onToggleStatus,
    onDelete,
    onOpenSession,
    onRetryHistory,
}: HappyHerdAutomationDetailProps) {
    const { theme } = useUnistyles();
    const [instructionExpanded, setInstructionExpanded] = React.useState(false);
    const [allRuns, setAllRuns] = React.useState(false);
    const active = automation.status === 'active';
    const heartbeat = automation.kind === 'heartbeat';
    const schedule = heartbeat
        ? `${t('happyHerd.heartbeat.every')} ${automation.intervalSeconds}s`
        : automation.schedule;
    const project = automation.tags.length > 0
        ? automation.tags.join(' · ')
        : t('happyHerd.automations.untagged');
    const lastRun = automation.lastRunAt
        ? new Date(automation.lastRunAt).toLocaleString()
        : t('happyHerd.automations.neverRun');
    const runs = history ?? [];
    const nextRun = happyHerdAutomationNextRun(automation, translateAutomation);
    const visibleRuns = allRuns ? runs : runs.slice(0, HAPPYHERD_AUTOMATION_RECENT_RUNS);

    React.useEffect(() => {
        setInstructionExpanded(false);
        setAllRuns(false);
    }, [automation.id]);

    const toggleHistory = React.useCallback(() => {
        const next = !allRuns;
        setAllRuns(next);
        if (next) onRetryHistory();
    }, [allRuns, onRetryHistory]);

    return (
        <View accessibilityLabel={t('happyHerd.automations.details')} style={styles.body}>
            {/* Instructions (or the command) first, then the actions, as in the mock. */}
            {automation.rail === 'exec' ? (
                <>
                    <HerdSectionLabel>{t('happyHerd.automations.command')}</HerdSectionLabel>
                    <View style={styles.grid}>
                        <Field label={t('happyHerd.automations.executable')} value={automation.executable} mono />
                        <Field
                            label={t('happyHerd.automations.arguments')}
                            value={JSON.stringify(automation.arguments)}
                            mono
                        />
                    </View>
                </>
            ) : (
                <>
                    <HerdSectionLabel>{t('happyHerd.automations.instructions')}</HerdSectionLabel>
                    <View style={[styles.instructionCard, { borderColor: theme.colors.divider }]}>
                        <View
                            testID="automation-instruction-markdown"
                            style={[styles.instructionBody, !instructionExpanded && styles.instructionCollapsed]}
                        >
                            <MarkdownView markdown={automation.instruction} />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ expanded: instructionExpanded }}
                            aria-expanded={instructionExpanded}
                            accessibilityLabel={t(
                                instructionExpanded
                                    ? 'happyHerd.automations.showLessInstruction'
                                    : 'happyHerd.automations.showFullInstruction',
                            )}
                            onPress={() => setInstructionExpanded((current) => !current)}
                            style={({ pressed }) => [
                                styles.instructionAffordance,
                                { borderTopColor: theme.colors.divider },
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={[styles.linkText, { color: theme.colors.textLink }]}>
                                {t(
                                    instructionExpanded
                                        ? 'happyHerd.automations.showLessInstruction'
                                        : 'happyHerd.automations.showFullInstruction',
                                )}
                            </Text>
                            <Ionicons
                                name={instructionExpanded ? 'chevron-up' : 'chevron-down'}
                                size={15}
                                color={theme.colors.textLink}
                            />
                        </Pressable>
                    </View>
                </>
            )}

            <View testID="automation-actions" style={[styles.actions, styles.actionsAfterContent]}>
                {!heartbeat && (
                    <HerdButton
                        size="sm"
                        variant="primary"
                        icon="play"
                        label={t('happyHerd.automations.runNow')}
                        onPress={onRunNow}
                    />
                )}
                {!heartbeat && (
                    <HerdButton
                        size="sm"
                        icon={active ? 'pause' : 'play-outline'}
                        label={active ? t('happyHerd.automations.pause') : t('happyHerd.automations.resume')}
                        onPress={onToggleStatus}
                    />
                )}
                <HerdButton
                    size="sm"
                    variant={heartbeat ? 'primary' : 'default'}
                    icon={heartbeat ? 'open-outline' : 'create-outline'}
                    label={heartbeat ? t('happyHerd.heartbeat.openTarget') : t('happyHerd.automations.editAction')}
                    onPress={onEdit}
                />
                <HerdButton
                    size="sm"
                    icon="time-outline"
                    label={t('happyHerd.automations.history')}
                    selected={allRuns}
                    onPress={toggleHistory}
                />
                {/* The mock's action row ends with the next run, or Paused, at the right. */}
                <StyledText testID="automation-next-run" style={[styles.nextRun, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {nextRun ?? (active ? '' : t('happyHerd.automations.statusPaused'))}
                </StyledText>
            </View>

            <HerdSectionLabel>{t('happyHerd.automations.details')}</HerdSectionLabel>
            <View style={styles.grid}>
                <Field label={t('happyHerd.automations.machine')} value={machineName} mono />
                <Field label={t('happyHerd.automations.project')} value={project} />
                <Field
                    label={t('happyHerd.automations.kind')}
                    value={happyHerdAutomationKindLabel(automation.kind, translateAutomation)}
                />
                <Field label={t('happyHerd.automations.rail')} value={automation.rail} mono />
                {automation.rail !== 'exec' && (
                    <Field
                        label={t('happyHerd.automations.commander')}
                        value={automation.commanderId
                            ? commanderName ?? automation.commanderId
                            : t('happyHerd.automations.none')}
                    />
                )}
                <Field label={t('happyHerd.automations.workspace')} value={automation.workspace} mono />
            </View>

            <HerdSectionLabel>{t('happyHerd.automations.scheduleSection')}</HerdSectionLabel>
            <View style={styles.grid}>
                <Field
                    label={heartbeat ? t('happyHerd.heartbeat.interval') : t('happyHerd.automations.cron')}
                    value={schedule}
                    mono
                />
                <Field label={t('happyHerd.automations.timezone')} value={automation.timezone} mono />
                <Field label={t('happyHerd.automations.lastRun')} value={lastRun} mono />
            </View>

            <HerdSectionLabel>{t('happyHerd.automations.previousRuns')}</HerdSectionLabel>
            <View accessibilityLabel={t('happyHerd.automations.previousRuns')} style={styles.runs}>
                {historyLoading && runs.length === 0 ? (
                    <View style={styles.historyLoading}>
                        <ActivityIndicator color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.textSecondary }}>
                            {t('happyHerd.automations.loadingRuns')}
                        </Text>
                    </View>
                ) : historyFailed ? (
                    <View style={styles.historyError}>
                        <Text style={{ color: theme.colors.status.disconnected }}>
                            {t('happyHerd.automations.unableHistory')}
                        </Text>
                        <HerdButton size="sm" label={t('common.retry')} onPress={onRetryHistory} />
                    </View>
                ) : visibleRuns.length > 0 ? visibleRuns.map((run) => {
                    const fresh = run.id === freshRunId;
                    const settled = run.status === 'completed';
                    const row = (
                        <>
                            <View style={styles.runState}><RunState run={run} fresh={fresh} /></View>
                            <Text style={styles.runStatus} numberOfLines={1}>
                                {happyHerdAutomationRunStatusLabel(run.status, translateAutomation)}
                            </Text>
                            <Text style={[styles.runTime, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                {new Date(run.scheduledFor).toLocaleString()}
                            </Text>
                            <Text style={[styles.runMessage, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                                {run.message ?? ''}
                            </Text>
                            {run.sessionId && (
                                <StyledText style={[styles.linkText, styles.runOpen, { color: theme.colors.textLink }]} numberOfLines={1}>
                                    {t('happyHerd.automations.openSessionLink')}
                                </StyledText>
                            )}
                        </>
                    );
                    const rowStyle = [
                        styles.runRow(fresh),
                        fresh && styles.runFresh,
                        fresh && settled && styles.runFreshDone,
                    ];
                    return run.sessionId ? (
                        <Pressable
                            key={run.id}
                            accessibilityRole="link"
                            accessibilityLabel={t('happyHerd.automations.openSession', { id: run.sessionId })}
                            onPress={() => onOpenSession(run.sessionId!)}
                            style={({ pressed }) => [...rowStyle, styles.runLink, pressed && styles.pressed]}
                        >
                            {row}
                        </Pressable>
                    ) : (
                        <View key={run.id} style={rowStyle}>
                            {row}
                        </View>
                    );
                }) : (
                    <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.automations.noRuns')}</Text>
                )}
            </View>

            {!heartbeat && (
                <>
                    <HerdSectionLabel>{t('happyHerd.automations.lifecycle')}</HerdSectionLabel>
                    <View style={styles.actions}>
                        <HerdButton
                            size="sm"
                            label={active ? t('happyHerd.automations.pause') : t('happyHerd.automations.resume')}
                            onPress={onToggleStatus}
                        />
                        <HerdButton
                            size="sm"
                            variant="danger"
                            icon="trash-outline"
                            label={t('happyHerd.automations.delete')}
                            onPress={onDelete}
                        />
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    body: {
        paddingTop: 14,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
    },
    // The mock's 14 px between the instructions (or command) and the action row.
    actionsAfterContent: {
        marginTop: 14,
    },
    nextRun: {
        marginLeft: 'auto',
        fontSize: 12,
        ...Typography.mono(),
    },
    runOpen: {
        marginLeft: 'auto',
        flexShrink: 0,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 20,
        rowGap: 12,
    },
    field: {
        minWidth: 180,
        flexGrow: 1,
        flexBasis: 180,
    },
    fieldLabel: {
        ...Typography.mono(),
        fontSize: 11.5,
        lineHeight: 15,
    },
    fieldValue: {
        marginTop: 3,
        fontSize: 14,
        lineHeight: 20,
    },
    mono: {
        ...Typography.mono(),
        fontSize: 13,
    },
    instructionCard: {
        borderWidth: 1,
        borderRadius: theme.kilv.radius,
        overflow: 'hidden',
        backgroundColor: theme.colors.input.background,
    },
    instructionBody: {
        paddingHorizontal: 14,
        paddingTop: 10,
    },
    instructionCollapsed: {
        maxHeight: 92,
        overflow: 'hidden',
    },
    instructionAffordance: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    linkText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    runs: {
        gap: 6,
    },
    historyLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 8,
    },
    historyError: {
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 8,
    },
    // The only style in a run row's list that sets web classes (see Unistyles `_web` merging).
    runRow: (fresh: boolean) => ({
        minHeight: 40,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 10,
        rowGap: 2,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.input.background,
        _web: { _classNames: herdWebClasses('herd-transition', fresh && 'herd-slide-left') },
    }),
    runLink: {
        _web: { cursor: 'pointer', _hover: { borderColor: theme.colors.kilv.rimLine } },
    },
    runFresh: {
        borderColor: theme.colors.selection.border,
    },
    runFreshDone: {
        borderColor: theme.colors.diff.success,
        _web: { boxShadow: `0 0 18px ${theme.colors.diff.addedBg}` },
    },
    freshCheck: {
        _web: { _classNames: herdWebClasses('herd-check') },
    },
    runState: {
        width: 18,
        alignItems: 'center',
    },
    runStatus: {
        minWidth: 88,
        ...Typography.default('semiBold'),
        fontSize: 14,
    },
    runTime: {
        ...Typography.mono(),
        fontSize: 12,
    },
    // Wraps below the status and time when the row is too narrow to hold it.
    runMessage: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 200,
        minWidth: 0,
        fontSize: 13,
    },
    pressed: {
        opacity: 0.72,
    },
}));
