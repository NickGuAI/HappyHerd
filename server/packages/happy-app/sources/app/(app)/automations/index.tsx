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
import { useFocusEffect } from '@react-navigation/native';
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
import { createHappyHerdAutomationMachineActions } from '@/components/happyHerdAutomationActions';
import {
    groupHappyHerdAutomationsByProject,
    happyHerdAutomationMachineName,
    happyHerdAutomationProjectKey,
    happyHerdAutomationReloadKey,
    happyHerdAutomationTagInput,
    loadHappyHerdAutomationMachines,
    type HappyHerdAutomationMachineCollection,
    type HappyHerdAutomationMachineFailure,
} from '@/components/happyHerdAutomationGroups';
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

const automationMachineActions = createHappyHerdAutomationMachineActions({
    pause: machinePauseAutomation,
    resume: machineResumeAutomation,
    runNow: machineRunAutomationNow,
    history: machineAutomationHistory,
    delete: machineDeleteAutomation,
});

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
    tags: string;
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
        tags: '',
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
        tags: automation.tags.join('\n'),
    };
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
    editable = true,
}: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    multiline?: boolean;
    placeholder?: string;
    editable?: boolean;
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
                editable={editable}
                placeholderTextColor={theme.colors.textSecondary}
                style={[
                    styles.input,
                    multiline && styles.multiline,
                    !editable && styles.inputDisabled,
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
    const onlineMachines = React.useMemo(() => machines.filter(isMachineOnline), [machines]);
    const onlineMachinesRef = React.useRef(onlineMachines);
    onlineMachinesRef.current = onlineMachines;
    const automationReloadKey = happyHerdAutomationReloadKey(machines);
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const machine = machines.find((candidate) => candidate.id === machineId) ?? null;
    const machineExists = machine !== null;
    const machineOnline = machine ? isMachineOnline(machine) : false;
    const [machineCollections, setMachineCollections] = React.useState<HappyHerdAutomationMachineCollection<Machine>[]>([]);
    const [machineFailures, setMachineFailures] = React.useState<HappyHerdAutomationMachineFailure<Machine>[]>([]);
    const [commanders, setCommanders] = React.useState<HappyHerdCommanderSummary[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editingMachineId, setEditingMachineId] = React.useState<string | null>(null);
    const [formVisible, setFormVisible] = React.useState(false);
    const [draft, setDraft] = React.useState<Draft>(() => emptyDraft());
    const [history, setHistory] = React.useState<Record<string, HappyHerdAutomationRun[]>>({});
    const projects = React.useMemo(
        () => groupHappyHerdAutomationsByProject(machineCollections),
        [machineCollections],
    );
    const automationCount = React.useMemo(
        () => machineCollections.reduce((count, collection) => count + collection.automations.length, 0),
        [machineCollections],
    );
    const selectedDefinitionSchemaVersion = machineCollections.find(
        (collection) => collection.machine.id === (editingMachineId ?? machineId),
    )?.definitionSchemaVersion ?? 1;
    const tagsSupported = selectedDefinitionSchemaVersion >= 2;

    React.useEffect(() => {
        if (machineId && machines.some((candidate) => candidate.id === machineId)) return;
        const preferred = onlineMachines[0] ?? machines[0];
        setMachineId(preferred?.id ?? null);
    }, [machineId, machines, onlineMachines]);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const result = await loadHappyHerdAutomationMachines(onlineMachinesRef.current, machineListAutomations);
            setMachineCollections(result.collections);
            setMachineFailures(result.failures);
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        React.useCallback(() => {
            void refresh();
        }, [automationReloadKey, refresh]),
    );

    useFocusEffect(React.useCallback(() => {
        let cancelled = false;
        if (!machineId || !machineExists || !machineOnline) {
            setCommanders([]);
            setError(machineExists ? t('happyHerd.automations.machineOffline') : null);
            return () => { cancelled = true; };
        }
        setError(null);
        void machineListCommanders(machineId).then(
            (result) => {
                if (!cancelled) setCommanders(result.commanders);
            },
            (nextError) => {
                if (!cancelled) {
                    setCommanders([]);
                    setError(nextError instanceof Error ? nextError.message : t('happyHerd.automations.unableLoad'));
                }
            },
        );
        return () => { cancelled = true; };
    }, [machineExists, machineId, machineOnline]));

    const openCreate = React.useCallback(() => {
        if (!machine || !isMachineOnline(machine)) return;
        setEditingId(null);
        setEditingMachineId(null);
        setDraft(emptyDraft(machine.metadata?.homeDir));
        setFormVisible(true);
    }, [machine]);

    const openEdit = React.useCallback((automation: HappyHerdAutomation) => {
        setMachineId(automation.machineId);
        setEditingId(automation.id);
        setEditingMachineId(automation.machineId);
        setDraft(draftFromAutomation(automation));
        setFormVisible(true);
    }, []);

    const save = React.useCallback(async () => {
        const targetMachineId = editingMachineId ?? machineId;
        if (!targetMachineId) return;
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
                ...happyHerdAutomationTagInput(draft.tags, selectedDefinitionSchemaVersion),
            };
            if (editingId) {
                await machineUpdateAutomation(targetMachineId, editingId, input);
            } else {
                await machineCreateAutomation(targetMachineId, input);
            }
            setFormVisible(false);
            setEditingId(null);
            setEditingMachineId(null);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableSave'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        } finally {
            setSaving(false);
        }
    }, [draft, editingId, editingMachineId, machineId, refresh, selectedDefinitionSchemaVersion]);

    const toggleStatus = React.useCallback(async (automation: HappyHerdAutomation) => {
        try {
            await automationMachineActions.toggleStatus(automation);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableUpdate'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [refresh]);

    const runNow = React.useCallback(async (automation: HappyHerdAutomation) => {
        try {
            const run = await automationMachineActions.runNow(automation);
            setHistory((current) => ({ ...current, [automation.id]: [run, ...(current[automation.id] ?? [])] }));
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableRun'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [refresh]);

    const loadHistory = React.useCallback(async (automation: HappyHerdAutomation) => {
        if (history[automation.id]) {
            setHistory((current) => {
                const next = { ...current };
                delete next[automation.id];
                return next;
            });
            return;
        }
        try {
            const result = await automationMachineActions.history(automation);
            setHistory((current) => ({ ...current, [automation.id]: result.runs }));
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableHistory'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [history]);

    const remove = React.useCallback(async (automation: HappyHerdAutomation) => {
        const confirmed = await Modal.confirm(
            t('happyHerd.automations.deleteTitle'),
            t('happyHerd.automations.deleteDescription', { name: automation.name }),
            { confirmText: t('happyHerd.automations.delete'), destructive: true },
        );
        if (!confirmed) return;
        try {
            await automationMachineActions.delete(automation);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableDelete'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [refresh]);

    return (
        <ScrollView contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}>
            <Stack.Screen options={{ title: t('happyHerd.automations.title') }} />
            <View style={styles.hero}>
                <View style={styles.heroCopy}>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {t('happyHerd.automations.subtitle')}
                    </Text>
                    <Text style={[styles.tagGuide, { color: theme.colors.textSecondary }]}>
                        {t('happyHerd.automations.tagGuide')}
                    </Text>
                </View>
                <Pressable
                    disabled={!machine || !isMachineOnline(machine)}
                    style={[
                        styles.primaryButton,
                        { backgroundColor: theme.colors.text },
                        (!machine || !isMachineOnline(machine)) && styles.buttonDisabled,
                    ]}
                    onPress={openCreate}
                >
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
                            {happyHerdAutomationMachineName(candidate)}
                        </Text>
                    </Pressable>
                ))}
            </ScrollView>

            {error && <Text style={[styles.notice, { color: theme.colors.status.disconnected, borderColor: theme.colors.divider }]}>{error}</Text>}
            {machineFailures.map((failure) => (
                <Text
                    key={failure.machine.id}
                    style={[styles.notice, { color: theme.colors.status.disconnected, borderColor: theme.colors.divider }]}
                >
                    {t('happyHerd.automations.machineLoadFailed', {
                        name: happyHerdAutomationMachineName(failure.machine),
                        message: failure.error.message,
                    })}
                </Text>
            ))}
            {loading && <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.text} />}

            {formVisible && (
                <View style={[styles.form, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>{editingId ? t('happyHerd.automations.edit') : t('happyHerd.automations.create')}</Text>
                        <Pressable onPress={() => {
                            setFormVisible(false);
                            setEditingId(null);
                            setEditingMachineId(null);
                        }}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
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
                    <Field
                        label={t('happyHerd.automations.tags')}
                        value={draft.tags}
                        multiline
                        editable={tagsSupported}
                        placeholder={t('happyHerd.automations.tagsHint')}
                        onChangeText={(tags) => setDraft((current) => ({ ...current, tags }))}
                    />
                    {!tagsSupported && (
                        <Text style={{ color: theme.colors.textSecondary }}>
                            {t('happyHerd.automations.tagsRequiresUpgrade')}
                        </Text>
                    )}
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
                {!loading && automationCount === 0 && (
                    <View style={[styles.empty, { borderColor: theme.colors.divider }]}>
                        <Ionicons name="time-outline" size={32} color={theme.colors.textSecondary} />
                        <Text style={styles.sectionTitle}>{t('happyHerd.automations.emptyTitle')}</Text>
                        <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.automations.emptySubtitle')}</Text>
                    </View>
                )}
                {projects.map((project) => (
                    <View
                        key={happyHerdAutomationProjectKey(project.tag)}
                        style={[styles.projectGroup, { borderColor: theme.colors.divider }]}
                    >
                        <Text style={styles.projectTitle}>
                            {project.tag ?? t('happyHerd.automations.untagged')}
                        </Text>
                        {project.machines.map((collection) => (
                            <View key={collection.machine.id} style={styles.machineGroup}>
                                <View style={styles.machineHeader}>
                                    <View style={[styles.statusDot, { backgroundColor: '#34C759' }]} />
                                    <Text style={styles.machineTitle}>
                                        {happyHerdAutomationMachineName(collection.machine)}
                                    </Text>
                                </View>
                                <View style={styles.machineCards}>
                                    {collection.automations.map((automation) => (
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
                            </View>
                        ))}
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { padding: 16, paddingBottom: 80, gap: 16 },
    pageDesktop: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: 28 },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    heroCopy: { flex: 1, gap: 6 },
    subtitle: { fontSize: 15, lineHeight: 21, maxWidth: 680 },
    tagGuide: { fontSize: 13, lineHeight: 19, maxWidth: 680 },
    primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
    buttonDisabled: { opacity: 0.45 },
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
    inputDisabled: { opacity: 0.55 },
    multiline: { minHeight: 112, textAlignVertical: 'top' },
    twoColumns: { flexDirection: 'row', gap: 12 },
    choice: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
    choiceText: { fontSize: 13 },
    saveButton: { alignSelf: 'flex-start', minWidth: 160 },
    list: { gap: 12 },
    projectGroup: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 16 },
    projectTitle: { fontSize: 19, ...Typography.default('semiBold') },
    machineGroup: { gap: 10 },
    machineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    machineTitle: { fontSize: 15, ...Typography.default('semiBold') },
    machineCards: { gap: 10 },
    empty: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 28, alignItems: 'center', gap: 8 },
}));
