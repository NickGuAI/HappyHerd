import * as React from 'react';
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {
    HappyHerdAutomation,
    HappyHerdAutomationCreateInput,
    HappyHerdAutomationRun,
    HappyHerdCommanderSummary,
} from '@slopus/happy-wire';

import { Text as StyledText } from '@/components/StyledText';
import { HappyHerdAutomationCard } from '@/components/HappyHerdAutomationCard';
import { Modal } from '@/modal';
import {
    machineAutomationHistory,
    machineCreateAutomation,
    machineDeleteAutomation,
    machineListAutomations,
    machineListCommanders,
    machinePauseAutomation,
    machineResumeAutomation,
    machineRunAutomationNow,
    machineUpdateAutomation,
} from '@/sync/ops';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';

type Draft = {
    name: string;
    kind: HappyHerdAutomationCreateInput['kind'];
    instruction: string;
    schedule: string;
    timezone: string;
    workspace: string;
    rail: HappyHerdAutomationCreateInput['rail'];
    commanderId: string | null;
    status: HappyHerdAutomationCreateInput['status'];
    maxRetries: string;
};

function Text(props: React.ComponentProps<typeof StyledText>) {
    const { theme } = useUnistyles();
    return <StyledText {...props} style={[{ color: theme.colors.text }, props.style]} />;
}

function localTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

function emptyDraft(homeDir?: string): Draft {
    return {
        name: '',
        kind: 'scheduled',
        instruction: '',
        schedule: '0 8 * * *',
        timezone: localTimezone(),
        workspace: homeDir || '~',
        rail: 'claude',
        commanderId: null,
        status: 'paused',
        maxRetries: '0',
    };
}

function draftFromAutomation(automation: HappyHerdAutomation): Draft {
    return {
        name: automation.name,
        kind: automation.kind,
        instruction: automation.instruction,
        schedule: automation.schedule,
        timezone: automation.timezone,
        workspace: automation.workspace,
        rail: automation.rail,
        commanderId: automation.commanderId,
        status: automation.status,
        maxRetries: String(automation.maxRetries),
    };
}

function machineName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

function Choice<T extends string>({
    value,
    selected,
    onSelect,
}: {
    value: T;
    selected: boolean;
    onSelect: (value: T) => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={() => onSelect(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.choice, selected && { backgroundColor: theme.colors.text }]}
        >
            <Text style={[styles.choiceText, selected && { color: theme.colors.surface }]}>{value}</Text>
        </Pressable>
    );
}

function Field({
    label,
    value,
    onChangeText,
    multiline = false,
    placeholder,
}: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    multiline?: boolean;
    placeholder?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                multiline={multiline}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.textSecondary}
                style={[
                    styles.input,
                    multiline && styles.multiline,
                    { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.input.background },
                ]}
            />
        </View>
    );
}

export default function AutomationsScreen() {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const { width } = useWindowDimensions();
    const desktop = (Platform.OS === 'web' || Platform.OS === 'macos') && width >= 900;
    const machines = useAllMachines({ includeOffline: true });
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const machine = machines.find((candidate) => candidate.id === machineId) ?? null;
    const [automations, setAutomations] = React.useState<HappyHerdAutomation[]>([]);
    const [commanders, setCommanders] = React.useState<HappyHerdCommanderSummary[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [formVisible, setFormVisible] = React.useState(false);
    const [draft, setDraft] = React.useState<Draft>(() => emptyDraft());
    const [history, setHistory] = React.useState<Record<string, HappyHerdAutomationRun[]>>({});

    React.useEffect(() => {
        if (machineId && machines.some((candidate) => candidate.id === machineId)) return;
        const preferred = machines.find(isMachineOnline) ?? machines[0];
        setMachineId(preferred?.id ?? null);
    }, [machineId, machines]);

    const refresh = React.useCallback(async () => {
        if (!machineId || !machine || !isMachineOnline(machine)) {
            setAutomations([]);
            setCommanders([]);
            setError(machine ? t('happyHerd.automations.machineOffline') : null);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const [automationResult, commanderResult] = await Promise.all([
                machineListAutomations(machineId),
                machineListCommanders(machineId),
            ]);
            setAutomations(automationResult.automations);
            setCommanders(commanderResult.commanders);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : t('happyHerd.automations.unableLoad'));
        } finally {
            setLoading(false);
        }
    }, [machine, machineId]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    const openCreate = React.useCallback(() => {
        setEditingId(null);
        setDraft(emptyDraft(machine?.metadata?.homeDir));
        setFormVisible(true);
    }, [machine?.metadata?.homeDir]);

    const openEdit = React.useCallback((automation: HappyHerdAutomation) => {
        setEditingId(automation.id);
        setDraft(draftFromAutomation(automation));
        setFormVisible(true);
    }, []);

    const save = React.useCallback(async () => {
        if (!machineId) return;
        setSaving(true);
        try {
            const input: HappyHerdAutomationCreateInput = {
                name: draft.name.trim(),
                kind: draft.kind,
                instruction: draft.instruction.trim(),
                schedule: draft.schedule.trim(),
                timezone: draft.timezone.trim(),
                workspace: draft.workspace.trim(),
                rail: draft.rail,
                commanderId: draft.commanderId,
                status: draft.status,
                maxRetries: Number.parseInt(draft.maxRetries, 10),
            };
            if (editingId) {
                await machineUpdateAutomation(machineId, editingId, input);
            } else {
                await machineCreateAutomation(machineId, input);
            }
            setFormVisible(false);
            setEditingId(null);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableSave'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        } finally {
            setSaving(false);
        }
    }, [draft, editingId, machineId, refresh]);

    const toggleStatus = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (!machineId) return;
        try {
            if (automation.status === 'active') await machinePauseAutomation(machineId, automation.id);
            else await machineResumeAutomation(machineId, automation.id);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableUpdate'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [machineId, refresh]);

    const runNow = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (!machineId) return;
        try {
            const run = await machineRunAutomationNow(machineId, automation.id);
            setHistory((current) => ({ ...current, [automation.id]: [run, ...(current[automation.id] ?? [])] }));
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableRun'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [machineId, refresh]);

    const loadHistory = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (!machineId) return;
        if (history[automation.id]) {
            setHistory((current) => {
                const next = { ...current };
                delete next[automation.id];
                return next;
            });
            return;
        }
        try {
            const result = await machineAutomationHistory(machineId, automation.id);
            setHistory((current) => ({ ...current, [automation.id]: result.runs }));
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableHistory'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [history, machineId]);

    const remove = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (!machineId) return;
        const confirmed = await Modal.confirm(
            t('happyHerd.automations.deleteTitle'),
            t('happyHerd.automations.deleteDescription', { name: automation.name }),
            { confirmText: t('happyHerd.automations.delete'), destructive: true },
        );
        if (!confirmed) return;
        try {
            await machineDeleteAutomation(machineId, automation.id);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableDelete'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [machineId, refresh]);

    return (
        <ScrollView contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}>
            <Stack.Screen options={{ title: t('happyHerd.automations.title') }} />
            <View style={styles.hero}>
                <View style={styles.heroCopy}>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {t('happyHerd.automations.subtitle')}
                    </Text>
                </View>
                <Pressable style={[styles.primaryButton, { backgroundColor: theme.colors.text }]} onPress={openCreate}>
                    <Ionicons name="add" size={18} color={theme.colors.surface} />
                    <Text style={[styles.buttonText, { color: theme.colors.surface }]}>{t('happyHerd.automations.new')}</Text>
                </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                {machines.map((candidate) => (
                    <Pressable
                        key={candidate.id}
                        onPress={() => setMachineId(candidate.id)}
                        style={[
                            styles.machineChoice,
                            { borderColor: theme.colors.divider },
                            candidate.id === machineId && { backgroundColor: theme.colors.text },
                        ]}
                    >
                        <View style={[styles.statusDot, { backgroundColor: isMachineOnline(candidate) ? '#34C759' : theme.colors.textSecondary }]} />
                        <Text style={candidate.id === machineId ? { color: theme.colors.surface } : undefined} numberOfLines={1}>
                            {machineName(candidate)}
                        </Text>
                    </Pressable>
                ))}
            </ScrollView>

            {error && <Text style={[styles.notice, { color: theme.colors.status.disconnected, borderColor: theme.colors.divider }]}>{error}</Text>}
            {loading && <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.text} />}

            {formVisible && (
                <View style={[styles.form, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>{editingId ? t('happyHerd.automations.edit') : t('happyHerd.automations.create')}</Text>
                        <Pressable onPress={() => setFormVisible(false)}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
                    </View>
                    <Field label={t('happyHerd.automations.name')} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
                    <Field label={t('happyHerd.automations.instruction')} value={draft.instruction} multiline onChangeText={(instruction) => setDraft((current) => ({ ...current, instruction }))} />
                    <Text style={styles.label}>{t('happyHerd.automations.kind')}</Text>
                    <View style={styles.choices}>
                        {(['scheduled', 'heartbeat', 'memory-maintenance'] as const).map((kind) => (
                            <Choice key={kind} value={kind} selected={draft.kind === kind} onSelect={(next) => setDraft((current) => ({ ...current, kind: next }))} />
                        ))}
                    </View>
                    <View style={desktop ? styles.twoColumns : undefined}>
                        <View style={{ flex: 1 }}><Field label={t('happyHerd.automations.cron')} value={draft.schedule} onChangeText={(schedule) => setDraft((current) => ({ ...current, schedule }))} /></View>
                        <View style={{ flex: 1 }}><Field label={t('happyHerd.automations.timezone')} value={draft.timezone} onChangeText={(timezone) => setDraft((current) => ({ ...current, timezone }))} /></View>
                    </View>
                    <Field label={t('happyHerd.automations.workspace')} value={draft.workspace} onChangeText={(workspace) => setDraft((current) => ({ ...current, workspace }))} />
                    <Text style={styles.label}>{t('happyHerd.automations.rail')}</Text>
                    <View style={styles.choices}>
                        {(['claude', 'codex'] as const).map((rail) => (
                            <Choice key={rail} value={rail} selected={draft.rail === rail} onSelect={(next) => setDraft((current) => ({ ...current, rail: next }))} />
                        ))}
                    </View>
                    <Text style={styles.label}>{t('happyHerd.automations.commander')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                        <Choice value={t('happyHerd.automations.none')} selected={draft.commanderId === null} onSelect={() => setDraft((current) => ({ ...current, commanderId: null }))} />
                        {commanders.map((commander) => (
                            <Choice key={commander.id} value={commander.name} selected={draft.commanderId === commander.id} onSelect={() => setDraft((current) => ({ ...current, commanderId: commander.id, workspace: commander.workspace }))} />
                        ))}
                    </ScrollView>
                    <View style={desktop ? styles.twoColumns : undefined}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>{t('happyHerd.automations.initialState')}</Text>
                            <View style={styles.choices}>
                                {(['paused', 'active'] as const).map((status) => (
                                    <Choice key={status} value={status} selected={draft.status === status} onSelect={(next) => setDraft((current) => ({ ...current, status: next }))} />
                                ))}
                            </View>
                        </View>
                        <View style={{ flex: 1 }}><Field label={t('happyHerd.automations.spawnRetries')} value={draft.maxRetries} onChangeText={(maxRetries) => setDraft((current) => ({ ...current, maxRetries }))} /></View>
                    </View>
                    <Pressable disabled={saving} style={[styles.primaryButton, styles.saveButton, { backgroundColor: theme.colors.text }]} onPress={() => void save()}>
                        {saving ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={[styles.buttonText, { color: theme.colors.surface }]}>{t('happyHerd.automations.save')}</Text>}
                    </Pressable>
                </View>
            )}

            <View style={styles.list}>
                {!loading && automations.length === 0 && (
                    <View style={[styles.empty, { borderColor: theme.colors.divider }]}>
                        <Ionicons name="time-outline" size={32} color={theme.colors.textSecondary} />
                        <Text style={styles.sectionTitle}>{t('happyHerd.automations.emptyTitle')}</Text>
                        <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.automations.emptySubtitle')}</Text>
                    </View>
                )}
                {automations.map((automation) => (
                    <HappyHerdAutomationCard
                        key={automation.id}
                        automation={automation}
                        history={history[automation.id]}
                        onToggleStatus={() => void toggleStatus(automation)}
                        onRunNow={() => void runNow(automation)}
                        onToggleHistory={() => void loadHistory(automation)}
                        onOpenSession={navigateToSession}
                        onEdit={() => openEdit(automation)}
                        onDelete={() => void remove(automation)}
                    />
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { padding: 16, paddingBottom: 80, gap: 16 },
    pageDesktop: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: 28 },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    heroCopy: { flex: 1 },
    subtitle: { fontSize: 15, lineHeight: 21, maxWidth: 680 },
    primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
    buttonText: { ...Typography.default('semiBold') },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    machineChoice: { maxWidth: 280, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, lineHeight: 19 },
    form: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 12 },
    sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    sectionTitle: { fontSize: 17, ...Typography.default('semiBold') },
    field: { gap: 6 },
    label: { fontSize: 13, color: theme.colors.textSecondary, ...Typography.default('semiBold') },
    input: { minHeight: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, ...Typography.default() },
    multiline: { minHeight: 112, textAlignVertical: 'top' },
    twoColumns: { flexDirection: 'row', gap: 12 },
    choice: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
    choiceText: { fontSize: 13 },
    saveButton: { alignSelf: 'flex-start', minWidth: 160 },
    list: { gap: 12 },
    empty: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 28, alignItems: 'center', gap: 8 },
}));
