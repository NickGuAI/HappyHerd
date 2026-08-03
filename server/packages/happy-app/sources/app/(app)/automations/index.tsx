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

import { Text } from '@/components/StyledText';
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
    const { width } = useWindowDimensions();
    const desktop = (Platform.OS === 'web' || Platform.OS === 'macos') && width >= 900;
    const machines = useAllMachines({ includeOffline: true });
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const machine = machines.find((candidate) => candidate.id === machineId) ?? null;
    const [automations, setAutomations] = React.useState<HappyHerdAutomation[]>([]);
    const [legacyCount, setLegacyCount] = React.useState(0);
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
            setError(machine ? 'This machine is offline. Its schedules remain durable and resume when the daemon returns.' : null);
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
            setLegacyCount(automationResult.legacyCount);
            setCommanders(commanderResult.commanders);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Unable to load automations');
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
            Modal.alert('Unable to save automation', nextError instanceof Error ? nextError.message : 'Unknown error');
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
            Modal.alert('Unable to update automation', nextError instanceof Error ? nextError.message : 'Unknown error');
        }
    }, [machineId, refresh]);

    const runNow = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (!machineId) return;
        try {
            const run = await machineRunAutomationNow(machineId, automation.id);
            setHistory((current) => ({ ...current, [automation.id]: [run, ...(current[automation.id] ?? [])] }));
            await refresh();
        } catch (nextError) {
            Modal.alert('Unable to run automation', nextError instanceof Error ? nextError.message : 'Unknown error');
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
            Modal.alert('Unable to load history', nextError instanceof Error ? nextError.message : 'Unknown error');
        }
    }, [history, machineId]);

    const remove = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (!machineId) return;
        const confirmed = await Modal.confirm(
            'Delete automation?',
            `${automation.name} and its local run history will be removed.`,
            { confirmText: 'Delete', destructive: true },
        );
        if (!confirmed) return;
        try {
            await machineDeleteAutomation(machineId, automation.id);
            await refresh();
        } catch (nextError) {
            Modal.alert('Unable to delete automation', nextError instanceof Error ? nextError.message : 'Unknown error');
        }
    }, [machineId, refresh]);

    return (
        <ScrollView contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}>
            <Stack.Screen options={{ title: 'Automations' }} />
            <View style={styles.hero}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Automations</Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        Heartbeats and scheduled jobs run on the selected machine through its HappyHerd daemon.
                    </Text>
                </View>
                <Pressable style={[styles.primaryButton, { backgroundColor: theme.colors.text }]} onPress={openCreate}>
                    <Ionicons name="add" size={18} color={theme.colors.surface} />
                    <Text style={[styles.buttonText, { color: theme.colors.surface }]}>New</Text>
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

            {legacyCount > 0 && (
                <Text style={[styles.notice, { color: theme.colors.textSecondary, borderColor: theme.colors.divider }]}>
                    {legacyCount} legacy Herd automation artifact{legacyCount === 1 ? '' : 's'} detected. HappyHerd leaves them unmanaged to prevent duplicate runs.
                </Text>
            )}
            {error && <Text style={[styles.notice, { color: theme.colors.status.disconnected, borderColor: theme.colors.divider }]}>{error}</Text>}
            {loading && <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.text} />}

            {formVisible && (
                <View style={[styles.form, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>{editingId ? 'Edit automation' : 'New automation'}</Text>
                        <Pressable onPress={() => setFormVisible(false)}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
                    </View>
                    <Field label="Name" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
                    <Field label="Instruction" value={draft.instruction} multiline onChangeText={(instruction) => setDraft((current) => ({ ...current, instruction }))} />
                    <Text style={styles.label}>Kind</Text>
                    <View style={styles.choices}>
                        {(['scheduled', 'heartbeat', 'memory-maintenance'] as const).map((kind) => (
                            <Choice key={kind} value={kind} selected={draft.kind === kind} onSelect={(next) => setDraft((current) => ({ ...current, kind: next }))} />
                        ))}
                    </View>
                    <View style={desktop ? styles.twoColumns : undefined}>
                        <View style={{ flex: 1 }}><Field label="Cron" value={draft.schedule} onChangeText={(schedule) => setDraft((current) => ({ ...current, schedule }))} /></View>
                        <View style={{ flex: 1 }}><Field label="Timezone" value={draft.timezone} onChangeText={(timezone) => setDraft((current) => ({ ...current, timezone }))} /></View>
                    </View>
                    <Field label="Machine workspace" value={draft.workspace} onChangeText={(workspace) => setDraft((current) => ({ ...current, workspace }))} />
                    <Text style={styles.label}>Provider rail</Text>
                    <View style={styles.choices}>
                        {(['claude', 'codex'] as const).map((rail) => (
                            <Choice key={rail} value={rail} selected={draft.rail === rail} onSelect={(next) => setDraft((current) => ({ ...current, rail: next }))} />
                        ))}
                    </View>
                    <Text style={styles.label}>Commander identity</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                        <Choice value="none" selected={draft.commanderId === null} onSelect={() => setDraft((current) => ({ ...current, commanderId: null }))} />
                        {commanders.map((commander) => (
                            <Choice key={commander.id} value={commander.name} selected={draft.commanderId === commander.id} onSelect={() => setDraft((current) => ({ ...current, commanderId: commander.id, workspace: commander.workspace }))} />
                        ))}
                    </ScrollView>
                    <View style={desktop ? styles.twoColumns : undefined}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>Initial state</Text>
                            <View style={styles.choices}>
                                {(['paused', 'active'] as const).map((status) => (
                                    <Choice key={status} value={status} selected={draft.status === status} onSelect={(next) => setDraft((current) => ({ ...current, status: next }))} />
                                ))}
                            </View>
                        </View>
                        <View style={{ flex: 1 }}><Field label="Spawn retries (0–5)" value={draft.maxRetries} onChangeText={(maxRetries) => setDraft((current) => ({ ...current, maxRetries }))} /></View>
                    </View>
                    <Pressable disabled={saving} style={[styles.primaryButton, styles.saveButton, { backgroundColor: theme.colors.text }]} onPress={() => void save()}>
                        {saving ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={[styles.buttonText, { color: theme.colors.surface }]}>Save automation</Text>}
                    </Pressable>
                </View>
            )}

            <View style={styles.list}>
                {!loading && automations.length === 0 && (
                    <View style={[styles.empty, { borderColor: theme.colors.divider }]}>
                        <Ionicons name="time-outline" size={32} color={theme.colors.textSecondary} />
                        <Text style={styles.sectionTitle}>No HappyHerd automations on this machine</Text>
                        <Text style={{ color: theme.colors.textSecondary }}>Create a paused definition first, inspect it, then enable it.</Text>
                    </View>
                )}
                {automations.map((automation) => (
                    <View key={automation.id} style={[styles.card, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                        <View style={styles.sectionHeader}>
                            <View style={{ flex: 1 }}>
                                <View style={styles.cardTitleRow}>
                                    <View style={[styles.statusDot, { backgroundColor: automation.status === 'active' ? '#34C759' : theme.colors.textSecondary }]} />
                                    <Text style={styles.sectionTitle}>{automation.name}</Text>
                                </View>
                                <Text style={{ color: theme.colors.textSecondary }}>{automation.schedule} · {automation.timezone}</Text>
                            </View>
                            <Text style={[styles.badge, { borderColor: theme.colors.divider }]}>{automation.kind}</Text>
                        </View>
                        <Text>{automation.instruction}</Text>
                        <Text style={{ color: theme.colors.textSecondary }}>{automation.rail} · {automation.workspace}{automation.commanderId ? ` · Commander ${automation.commanderId}` : ''}</Text>
                        <View style={styles.actions}>
                            <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={() => void toggleStatus(automation)}><Text>{automation.status === 'active' ? 'Pause' : 'Resume'}</Text></Pressable>
                            <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={() => void runNow(automation)}><Text>Run now</Text></Pressable>
                            <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={() => void loadHistory(automation)}><Text>History</Text></Pressable>
                            <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={() => openEdit(automation)}><Text>Edit</Text></Pressable>
                            <Pressable style={[styles.action, { borderColor: theme.colors.divider }]} onPress={() => void remove(automation)}><Text style={{ color: theme.colors.status.disconnected }}>Delete</Text></Pressable>
                        </View>
                        {history[automation.id] && (
                            <View style={[styles.history, { borderTopColor: theme.colors.divider }]}>
                                {history[automation.id].length === 0 ? (
                                    <Text style={{ color: theme.colors.textSecondary }}>No runs yet.</Text>
                                ) : history[automation.id].map((run) => (
                                    <View key={run.id} style={styles.historyRow}>
                                        <Text style={styles.historyStatus}>{run.status}</Text>
                                        <Text style={{ flex: 1, color: theme.colors.textSecondary }}>{new Date(run.scheduledFor).toLocaleString()} · attempt {run.attempt}{run.sessionId ? ` · ${run.sessionId}` : ''}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { padding: 16, paddingBottom: 80, gap: 16 },
    pageDesktop: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: 28 },
    hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    title: { fontSize: 30, ...Typography.default('semiBold') },
    subtitle: { marginTop: 4, fontSize: 15, lineHeight: 21, maxWidth: 680 },
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
    card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 10 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    action: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
    history: { marginTop: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
    historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    historyStatus: { width: 62, ...Typography.default('semiBold') },
}));
