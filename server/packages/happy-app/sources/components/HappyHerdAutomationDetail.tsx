import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@slopus/happy-wire';

import { Text as StyledText } from '@/components/StyledText';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import {
    happyHerdAutomationKindLabel,
    happyHerdAutomationRunStatusLabel,
} from '@/components/happyHerdAutomationPresentation';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

function Text(props: React.ComponentProps<typeof StyledText>) {
    const { theme } = useUnistyles();
    return <StyledText {...props} style={[{ color: theme.colors.text }, props.style]} />;
}

const translateAutomation = (key: any, params?: Record<string, string | number>) => (
    (t as any)(key, params)
);

type SettingRowProps = {
    label: string;
    value: string;
    mono?: boolean;
};

function SettingRow({ label, value, mono = false }: SettingRowProps) {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
            <Text>{label}</Text>
            <Text
                selectable
                style={[
                    styles.settingValue,
                    mono && styles.mono,
                    { color: theme.colors.textSecondary },
                ]}
            >
                {value}
            </Text>
        </View>
    );
}

export type HappyHerdAutomationDetailProps = {
    automation: HappyHerdAutomation;
    machineName: string;
    history?: HappyHerdAutomationRun[];
    historyLoading: boolean;
    historyFailed: boolean;
    mobile: boolean;
    onBack: () => void;
    onClose: () => void;
    onRunNow: () => void;
    onEdit: () => void;
    onToggleStatus: () => void;
    onDelete: () => void;
    onOpenSession: (sessionId: string) => void;
    onRetryHistory: () => void;
};

export function HappyHerdAutomationDetail({
    automation,
    machineName,
    history,
    historyLoading,
    historyFailed,
    mobile,
    onBack,
    onClose,
    onRunNow,
    onEdit,
    onToggleStatus,
    onDelete,
    onOpenSession,
    onRetryHistory,
}: HappyHerdAutomationDetailProps) {
    const { theme } = useUnistyles();
    const [instructionExpanded, setInstructionExpanded] = React.useState(false);
    const active = automation.status === 'active';
    const statusLabel = t(
        active
            ? 'happyHerd.automations.statusActive'
            : 'happyHerd.automations.statusPaused',
    );
    const schedule = automation.kind === 'heartbeat'
        ? `${t('happyHerd.heartbeat.every')} ${automation.intervalSeconds}s`
        : automation.schedule;
    const project = automation.tags.length > 0
        ? automation.tags.join(' · ')
        : t('happyHerd.automations.untagged');
    const lastRun = automation.lastRunAt
        ? new Date(automation.lastRunAt).toLocaleString()
        : t('happyHerd.automations.neverRun');

    React.useEffect(() => {
        setInstructionExpanded(false);
    }, [automation.id]);

    return (
        <View
            accessibilityLabel={t('happyHerd.automations.details')}
            style={[
                styles.panel,
                mobile ? styles.panelMobile : styles.panelDesktop,
                { backgroundColor: theme.colors.surface, borderLeftColor: theme.colors.divider },
            ]}
        >
            <View
                testID="automation-detail-header"
                style={[styles.header, { borderBottomColor: theme.colors.divider }]}
            >
                <View style={styles.headingRow}>
                    {mobile && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('happyHerd.automations.backToAutomations')}
                            onPress={onBack}
                            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                        >
                            <Ionicons name="chevron-back" size={19} color={theme.colors.text} />
                            <Text style={styles.backText}>{t('common.back')}</Text>
                        </Pressable>
                    )}
                    <View style={styles.headingCopy}>
                        <Text style={[styles.statusLabel, { color: active ? '#34C759' : theme.colors.textSecondary }]}>
                            {statusLabel}
                        </Text>
                        <Text style={styles.title} numberOfLines={2}>{automation.name}</Text>
                    </View>
                </View>
                <Pressable
                    testID="automation-detail-close"
                    accessibilityRole="button"
                    accessibilityLabel={t('happyHerd.automations.closeDetails')}
                    onPress={onClose}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                    <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator
            >
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                    {t('happyHerd.automations.instructions')}
                </Text>
                <View style={[styles.instructionCard, { borderColor: theme.colors.divider }]}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: instructionExpanded }}
                        accessibilityLabel={t(
                            instructionExpanded
                                ? 'happyHerd.automations.showLessInstruction'
                                : 'happyHerd.automations.showFullInstruction',
                        )}
                        onPress={() => setInstructionExpanded((current) => !current)}
                        style={({ pressed }) => [styles.instructionHeader, pressed && styles.pressed]}
                    >
                        <Text style={styles.instructionTitle}>{t('happyHerd.automations.instructions')}</Text>
                        <Ionicons
                            name={instructionExpanded ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    <View
                        testID="automation-instruction-markdown"
                        style={[
                            styles.instructionBody,
                            { borderTopColor: theme.colors.divider },
                            !instructionExpanded && styles.instructionCollapsed,
                        ]}
                    >
                        <MarkdownView markdown={automation.instruction} />
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setInstructionExpanded((current) => !current)}
                        style={({ pressed }) => [styles.instructionAffordance, pressed && styles.pressed]}
                    >
                        <Text style={[styles.linkText, { color: theme.colors.textLink }]}>
                            {t(
                                instructionExpanded
                                    ? 'happyHerd.automations.showLessInstruction'
                                    : 'happyHerd.automations.showFullInstruction',
                            )}
                        </Text>
                    </Pressable>
                </View>

                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                    {t('happyHerd.automations.details')}
                </Text>
                <View style={[styles.settingsCard, { borderColor: theme.colors.divider }]}>
                    <SettingRow label={t('happyHerd.automations.machine')} value={machineName} />
                    <SettingRow label={t('happyHerd.automations.project')} value={project} />
                    <SettingRow
                        label={t('happyHerd.automations.kind')}
                        value={happyHerdAutomationKindLabel(automation.kind, translateAutomation)}
                    />
                    <SettingRow label={t('happyHerd.automations.rail')} value={automation.rail} />
                    <SettingRow
                        label={t('happyHerd.automations.commander')}
                        value={automation.commanderId ?? t('happyHerd.automations.none')}
                    />
                    <SettingRow label={t('happyHerd.automations.workspace')} value={automation.workspace} mono />
                </View>

                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                    {t('happyHerd.automations.scheduleSection')}
                </Text>
                <View style={[styles.settingsCard, { borderColor: theme.colors.divider }]}>
                    <SettingRow
                        label={automation.kind === 'heartbeat'
                            ? t('happyHerd.heartbeat.interval')
                            : t('happyHerd.automations.cron')}
                        value={schedule}
                        mono
                    />
                    <SettingRow label={t('happyHerd.automations.timezone')} value={automation.timezone} mono />
                    <SettingRow label={t('happyHerd.automations.lastRun')} value={lastRun} />
                </View>

                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                    {t('happyHerd.automations.previousRuns')}
                </Text>
                <View accessibilityLabel={t('happyHerd.automations.previousRuns')}>
                    {historyLoading ? (
                        <View style={styles.historyLoading}>
                            <ActivityIndicator color={theme.colors.text} />
                            <Text style={{ color: theme.colors.textSecondary }}>
                                {t('happyHerd.automations.loadingRuns')}
                            </Text>
                        </View>
                    ) : historyFailed ? (
                        <View style={styles.historyError}>
                            <Text style={{ color: theme.colors.status.disconnected }}>
                                {t('happyHerd.automations.unableHistory')}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t('common.retry')}
                                onPress={onRetryHistory}
                                style={({ pressed }) => [
                                    styles.retryButton,
                                    { borderColor: theme.colors.divider },
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.buttonText}>{t('common.retry')}</Text>
                            </Pressable>
                        </View>
                    ) : history && history.length > 0 ? history.map((run) => {
                        const row = (
                            <>
                                <View
                                    style={[
                                        styles.runDot,
                                        {
                                            backgroundColor: run.status === 'failed'
                                                ? theme.colors.status.disconnected
                                                : '#34C759',
                                        },
                                    ]}
                                />
                                <View style={styles.runCopy}>
                                    <Text style={styles.runStatus}>
                                        {happyHerdAutomationRunStatusLabel(run.status, translateAutomation)}
                                    </Text>
                                    {run.message && (
                                        <Text style={{ color: theme.colors.textSecondary }} numberOfLines={2}>
                                            {run.message}
                                        </Text>
                                    )}
                                </View>
                                <Text style={[styles.runTime, { color: theme.colors.textSecondary }]}>
                                    {new Date(run.scheduledFor).toLocaleString()}
                                </Text>
                                {run.sessionId && (
                                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                                )}
                            </>
                        );
                        return run.sessionId ? (
                            <Pressable
                                key={run.id}
                                accessibilityRole="link"
                                accessibilityLabel={t('happyHerd.automations.openSession', { id: run.sessionId })}
                                onPress={() => onOpenSession(run.sessionId!)}
                                style={({ pressed }) => [
                                    styles.runRow,
                                    { borderBottomColor: theme.colors.divider },
                                    pressed && styles.pressed,
                                ]}
                            >
                                {row}
                            </Pressable>
                        ) : (
                            <View
                                key={run.id}
                                style={[styles.runRow, { borderBottomColor: theme.colors.divider }]}
                            >
                                {row}
                            </View>
                        );
                    }) : (
                        <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.automations.noRuns')}</Text>
                    )}
                </View>

                {automation.kind !== 'heartbeat' && (
                    <>
                        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                            {t('happyHerd.automations.lifecycle')}
                        </Text>
                        <View style={[styles.lifecycleCard, { borderColor: theme.colors.divider }]}>
                            <Pressable
                                accessibilityRole="button"
                                onPress={onToggleStatus}
                                style={({ pressed }) => [styles.lifecycleAction, pressed && styles.pressed]}
                            >
                                <Text>{active ? t('happyHerd.automations.pause') : t('happyHerd.automations.resume')}</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={onDelete}
                                style={({ pressed }) => [
                                    styles.lifecycleAction,
                                    {
                                        borderTopColor: theme.colors.divider,
                                        borderTopWidth: StyleSheet.hairlineWidth,
                                    },
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={{ color: theme.colors.status.disconnected }}>
                                    {t('happyHerd.automations.delete')}
                                </Text>
                            </Pressable>
                        </View>
                    </>
                )}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                {automation.kind !== 'heartbeat' && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={onRunNow}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: theme.colors.text },
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={[styles.buttonText, { color: theme.colors.surface }]}>
                            {t('happyHerd.automations.runNow')}
                        </Text>
                    </Pressable>
                )}
                <Pressable
                    accessibilityRole="button"
                    onPress={onEdit}
                    style={({ pressed }) => [
                        styles.secondaryButton,
                        { borderColor: theme.colors.divider },
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.buttonText}>
                        {automation.kind === 'heartbeat'
                            ? t('happyHerd.heartbeat.openTarget')
                            : t('happyHerd.automations.editAction')}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    panel: { minWidth: 0, flex: 1 },
    panelDesktop: {
        width: '34%',
        minWidth: 420,
        maxWidth: 470,
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: 'auto',
        borderLeftWidth: StyleSheet.hairlineWidth,
    },
    panelMobile: { width: '100%' },
    header: {
        minHeight: 92,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
    },
    headingRow: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    headingCopy: { minWidth: 0, flex: 1 },
    statusLabel: { fontSize: 12, ...Typography.default('semiBold') },
    title: { marginTop: 6, fontSize: 19, ...Typography.default('semiBold') },
    backButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
    backText: { ...Typography.default('semiBold') },
    iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28 },
    sectionLabel: { marginTop: 22, marginBottom: 9, marginHorizontal: 3, fontSize: 13, ...Typography.default('semiBold') },
    instructionCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
    instructionHeader: { paddingHorizontal: 15, paddingTop: 13, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    instructionTitle: { fontSize: 15, ...Typography.default('semiBold') },
    instructionBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 15, paddingTop: 13 },
    instructionCollapsed: { maxHeight: 92, overflow: 'hidden' },
    instructionAffordance: { paddingHorizontal: 15, paddingVertical: 12 },
    linkText: { fontSize: 13, ...Typography.default('semiBold') },
    settingsCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
    settingRow: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
    settingValue: { minWidth: 0, flexShrink: 1, textAlign: 'right' },
    mono: { fontFamily: 'monospace', fontSize: 12 },
    historyLoading: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8 },
    historyError: { alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
    retryButton: {
        minHeight: 38,
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 14,
    },
    runRow: { minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
    runDot: { width: 8, height: 8, borderRadius: 4 },
    runCopy: { minWidth: 0, flex: 1 },
    runStatus: { ...Typography.default('semiBold') },
    runTime: { maxWidth: 150, fontSize: 12, textAlign: 'right' },
    lifecycleCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
    lifecycleAction: { minHeight: 46, paddingHorizontal: 14, justifyContent: 'center' },
    footer: { paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9 },
    primaryButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    secondaryButton: { minHeight: 40, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    buttonText: { ...Typography.default('semiBold') },
    pressed: { opacity: 0.7 },
}));
