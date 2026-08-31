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
import { HappyHerdAutomationDetail } from '@/components/HappyHerdAutomationDetail';
import { createHappyHerdAutomationMachineActions } from '@/components/happyHerdAutomationActions';
import {
    filterHappyHerdAutomations,
    happyHerdAutomationsForMachine,
    happyHerdAutomationMachineName,
    happyHerdAutomationReloadKey,
    happyHerdAutomationTagInput,
    happyHerdAutomationTags,
    loadHappyHerdAutomationMachines,
    type HappyHerdAutomationMachineCollection,
    type HappyHerdAutomationMachineFailure,
} from '@/components/happyHerdAutomationGroups';
import {
    happyHerdAutomationKindLabel,
    happyHerdAutomationRowMeta,
} from '@/components/happyHerdAutomationPresentation';
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
import { getCurrentLanguage, t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import {
    automationProfileStart,
    profileAutomationRpc,
    recordAutomationProfile,
} from '@/utils/automationProfiling';

const automationMachineActions = createHappyHerdAutomationMachineActions({
    pause: (machineId, automationId) => profileAutomationRpc(
        'happyherd-automations-pause',
        () => machinePauseAutomation(machineId, automationId),
    ),
    resume: (machineId, automationId) => profileAutomationRpc(
        'happyherd-automations-resume',
        () => machineResumeAutomation(machineId, automationId),
    ),
    runNow: (machineId, automationId) => profileAutomationRpc(
        'happyherd-automations-run-now',
        () => machineRunAutomationNow(machineId, automationId),
    ),
    history: (machineId, automationId) => profileAutomationRpc(
        'happyherd-automations-history',
        () => machineAutomationHistory(machineId, automationId),
    ),
    delete: (machineId, automationId) => profileAutomationRpc(
        'happyherd-automations-delete',
        () => machineDeleteAutomation(machineId, automationId),
    ),
});

const MANUAL_EXEC_HISTORY_REFRESH_DELAYS_MS = [
    250,
    750,
    1_500,
    3_000,
    6_000,
    12_000,
    24_000,
    30_000,
    30_000,
] as const;

const translateAutomation = (key: any, params?: Record<string, string | number>) => (
    (t as any)(key, params)
);

type Draft = {
    name: string;
    kind: HappyHerdAutomationCreateInput['kind'];
    instruction: string;
    executable: string;
    arguments: string;
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
        executable: '',
        arguments: '',
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
    if (automation.kind === 'heartbeat') {
        throw new Error('Session heartbeats are configured from their target session');
    }
    return {
        name: automation.name,
        kind: automation.kind,
        instruction: automation.rail === 'exec' ? '' : automation.instruction,
        executable: automation.rail === 'exec' ? automation.executable : '',
        arguments: automation.rail === 'exec' ? automation.arguments.join('\n') : '',
        schedule: automation.schedule,
        timezone: automation.timezone,
        workspace: automation.workspace,
        rail: automation.rail,
        commanderId: automation.rail === 'exec' ? null : automation.commanderId,
        status: automation.status,
        maxRetries: automation.rail === 'exec' ? '0' : String(automation.maxRetries),
        tags: automation.tags.join('\n'),
    };
}

function Choice<T extends string>({
    value,
    label = value,
    selected,
    onSelect,
}: {
    value: T;
    label?: string;
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
            <Text style={[styles.choiceText, selected && { color: theme.colors.surface }]}>{label}</Text>
        </Pressable>
    );
}

function MachineChoice({
    machine,
    selected,
    disabled = false,
    onSelect,
}: {
    machine: Machine;
    selected: boolean;
    disabled?: boolean;
    onSelect?: (machineId: string) => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            disabled={disabled}
            onPress={() => onSelect?.(machine.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            style={[
                styles.machineChoice,
                { borderColor: theme.colors.divider },
                selected && { backgroundColor: theme.colors.text },
                disabled && styles.buttonDisabled,
            ]}
        >
            <View style={[
                styles.statusDot,
                { backgroundColor: isMachineOnline(machine) ? '#34C759' : theme.colors.textSecondary },
            ]} />
            <Text style={selected ? { color: theme.colors.surface } : undefined} numberOfLines={1}>
                {happyHerdAutomationMachineName(machine)}
            </Text>
        </Pressable>
    );
}

function FilterChip({
    label,
    selected,
    onSelect,
}: {
    label: string;
    selected: boolean;
    onSelect: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={onSelect}
            style={[
                styles.filterChip,
                selected && { backgroundColor: theme.colors.surfaceHighest },
            ]}
        >
            <Text style={[styles.filterChipText, selected && Typography.default('semiBold')]}>{label}</Text>
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
                accessibilityLabel={label}
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
    const [historyLoading, setHistoryLoading] = React.useState<Record<string, boolean>>({});
    const [historyFailed, setHistoryFailed] = React.useState<Record<string, boolean>>({});
    const [selectedTag, setSelectedTag] = React.useState<string | null>(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [selectedAutomationId, setSelectedAutomationId] = React.useState<string | null>(null);
    const execHistoryRefreshTokensRef = React.useRef(new Map<string, symbol>());
    const routeStartedAtRef = React.useRef<number | null>(null);
    const initialDataReadyAtRef = React.useRef<number | null>(null);
    const initialRenderProfiledRef = React.useRef(false);
    if (routeStartedAtRef.current === null) routeStartedAtRef.current = automationProfileStart();
    const formMachineId = editingMachineId ?? machineId;
    const formMachine = machines.find((candidate) => candidate.id === formMachineId) ?? null;
    const formMachineExists = formMachine !== null;
    const formMachineOnline = formMachine ? isMachineOnline(formMachine) : false;
    const createMachineChoices = React.useMemo(() => (
        machine && !isMachineOnline(machine)
            ? [machine, ...onlineMachines]
            : onlineMachines
    ), [machine, onlineMachines]);
    const tags = React.useMemo(() => happyHerdAutomationTags(machineCollections), [machineCollections]);
    const automations = React.useMemo(
        () => happyHerdAutomationsForMachine(machineCollections, machineId),
        [machineCollections, machineId],
    );
    const filteredAutomations = React.useMemo(
        () => filterHappyHerdAutomations(automations, selectedTag, searchQuery),
        [automations, searchQuery, selectedTag],
    );
    const selectedAutomation = React.useMemo(
        () => filteredAutomations.find((automation) => automation.id === selectedAutomationId) ?? null,
        [filteredAutomations, selectedAutomationId],
    );
    const selectedDefinitionSchemaVersion = machineCollections.find(
        (collection) => collection.machine.id === (editingMachineId ?? machineId),
    )?.definitionSchemaVersion ?? 1;
    const tagsSupported = selectedDefinitionSchemaVersion >= 2;
    const execSupported = selectedDefinitionSchemaVersion >= 4;

    React.useEffect(() => {
        if (formVisible && !execSupported && draft.rail === 'exec') {
            setDraft((current) => ({ ...current, rail: 'claude' }));
        }
    }, [draft.rail, execSupported, formVisible]);

    React.useEffect(() => {
        if (formVisible && machineId) return;
        if (machineId && onlineMachines.some((candidate) => candidate.id === machineId)) return;
        const preferred = onlineMachines[0] ?? machines[0];
        setMachineId(preferred?.id ?? null);
    }, [formVisible, machineId, machines, onlineMachines]);

    React.useEffect(() => {
        if (selectedTag !== null && !tags.includes(selectedTag)) {
            setSelectedTag(null);
        }
    }, [selectedTag, tags]);

    React.useEffect(() => {
        if (selectedAutomationId && !selectedAutomation) {
            setSelectedAutomationId(null);
        }
    }, [selectedAutomation, selectedAutomationId]);

    React.useEffect(() => () => {
        execHistoryRefreshTokensRef.current.clear();
    }, []);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const result = await loadHappyHerdAutomationMachines(
                onlineMachinesRef.current,
                (targetMachineId) => profileAutomationRpc(
                    'happyherd-automations-list',
                    () => machineListAutomations(targetMachineId),
                ),
            );
            setMachineCollections(result.collections);
            setMachineFailures(result.failures);
        } finally {
            if (initialDataReadyAtRef.current === null) {
                initialDataReadyAtRef.current = automationProfileStart();
            }
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        const dataReadyAt = initialDataReadyAtRef.current;
        const routeStartedAt = routeStartedAtRef.current;
        if (loading || initialRenderProfiledRef.current || dataReadyAt === null || routeStartedAt === null) return;

        initialRenderProfiledRef.current = true;
        recordAutomationProfile('render', 'commit', 'success', dataReadyAt);
        recordAutomationProfile('route', 'total', 'success', routeStartedAt);
    }, [loading, machineCollections, machineFailures]);

    useFocusEffect(
        React.useCallback(() => {
            void refresh();
        }, [automationReloadKey, refresh]),
    );

    useFocusEffect(React.useCallback(() => {
        let cancelled = false;
        if (!formMachineId || !formMachineExists || !formMachineOnline) {
            setCommanders([]);
            setError(formMachineExists ? t('happyHerd.automations.machineOffline') : null);
            return () => { cancelled = true; };
        }
        setError(null);
        void profileAutomationRpc(
            'happyherd-list-commanders',
            () => machineListCommanders(formMachineId),
        ).then(
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
    }, [formMachineExists, formMachineId, formMachineOnline]));

    const openCreate = React.useCallback(() => {
        if (!machine || !isMachineOnline(machine)) return;
        setSelectedAutomationId(null);
        setEditingId(null);
        setEditingMachineId(null);
        setDraft(emptyDraft(machine.metadata?.homeDir));
        setFormVisible(true);
    }, [machine]);

    const selectCreateMachine = React.useCallback((nextMachineId: string) => {
        const nextMachine = onlineMachines.find((candidate) => candidate.id === nextMachineId);
        if (!nextMachine) return;
        setMachineId(nextMachineId);
        setDraft((current) => ({
            ...current,
            workspace: nextMachine.metadata?.homeDir || '~',
            commanderId: null,
        }));
    }, [onlineMachines]);

    const selectBrowseMachine = React.useCallback((nextMachineId: string) => {
        setMachineId(nextMachineId);
        setSelectedAutomationId(null);
    }, []);

    const selectAutomation = React.useCallback((automationId: string) => {
        setHistoryFailed((current) => {
            if (!current[automationId]) return current;
            const next = { ...current };
            delete next[automationId];
            return next;
        });
        setSelectedAutomationId(automationId);
    }, []);

    const openEdit = React.useCallback((automation: HappyHerdAutomation) => {
        if (automation.kind === 'heartbeat') {
            navigateToSession(automation.targetSessionId);
            return;
        }
        setSelectedAutomationId(null);
        setMachineId(automation.machineId);
        setEditingId(automation.id);
        setEditingMachineId(automation.machineId);
        setDraft(draftFromAutomation(automation));
        setFormVisible(true);
    }, [navigateToSession]);

    const save = React.useCallback(async () => {
        const targetMachineId = editingMachineId ?? machineId;
        if (!targetMachineId) return;
        setSaving(true);
        try {
            const common = {
                name: draft.name.trim(),
                schedule: draft.schedule.trim(),
                timezone: draft.timezone.trim(),
                workspace: draft.workspace.trim(),
                status: draft.status,
                ...happyHerdAutomationTagInput(draft.tags, selectedDefinitionSchemaVersion),
            };
            const input: HappyHerdAutomationCreateInput = draft.rail === 'exec'
                ? {
                    ...common,
                    kind: 'scheduled',
                    rail: 'exec',
                    executable: draft.executable.trim(),
                    arguments: draft.arguments
                        .split('\n')
                        .filter((argument) => argument.length > 0),
                }
                : {
                    ...common,
                    kind: draft.kind,
                    instruction: draft.instruction.trim(),
                    rail: draft.rail,
                    commanderId: draft.commanderId,
                    maxRetries: Number.parseInt(draft.maxRetries, 10),
                };
            if (editingId) {
                await profileAutomationRpc(
                    'happyherd-automations-update',
                    () => machineUpdateAutomation(targetMachineId, editingId, input),
                );
            } else {
                await profileAutomationRpc(
                    'happyherd-automations-create',
                    () => machineCreateAutomation(targetMachineId, input),
                );
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

    const refreshManualExecHistory = React.useCallback(async (
        automation: HappyHerdAutomation,
        runId: string,
    ) => {
        const token = Symbol(runId);
        execHistoryRefreshTokensRef.current.set(automation.id, token);
        try {
            for (const delayMs of MANUAL_EXEC_HISTORY_REFRESH_DELAYS_MS) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                if (execHistoryRefreshTokensRef.current.get(automation.id) !== token) return;

                let result: { runs: HappyHerdAutomationRun[] };
                try {
                    result = await automationMachineActions.history(automation);
                } catch {
                    continue;
                }
                if (execHistoryRefreshTokensRef.current.get(automation.id) !== token) return;

                setHistory((current) => ({ ...current, [automation.id]: result.runs }));
                setHistoryFailed((current) => {
                    if (!current[automation.id]) return current;
                    const next = { ...current };
                    delete next[automation.id];
                    return next;
                });
                if (result.runs.find((candidate) => candidate.id === runId)?.status !== 'running') return;
            }
        } finally {
            if (execHistoryRefreshTokensRef.current.get(automation.id) === token) {
                execHistoryRefreshTokensRef.current.delete(automation.id);
            }
        }
    }, []);

    const runNow = React.useCallback(async (automation: HappyHerdAutomation) => {
        try {
            const run = await automationMachineActions.runNow(automation);
            setHistory((current) => ({ ...current, [automation.id]: [run, ...(current[automation.id] ?? [])] }));
            setHistoryFailed((current) => {
                if (!current[automation.id]) return current;
                const next = { ...current };
                delete next[automation.id];
                return next;
            });
            await refresh();
            if (automation.rail === 'exec' && run.execution === 'exec' && run.status === 'running') {
                void refreshManualExecHistory(automation, run.id);
            }
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableRun'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [refresh, refreshManualExecHistory]);

    const ensureHistory = React.useCallback(async (automation: HappyHerdAutomation, force = false) => {
        if (historyLoading[automation.id]) return;
        if (!force && (history[automation.id] !== undefined || historyFailed[automation.id])) return;
        setHistoryFailed((current) => {
            if (!current[automation.id]) return current;
            const next = { ...current };
            delete next[automation.id];
            return next;
        });
        setHistoryLoading((current) => ({ ...current, [automation.id]: true }));
        try {
            const result = await automationMachineActions.history(automation);
            setHistory((current) => ({ ...current, [automation.id]: result.runs }));
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableHistory'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
            setHistoryFailed((current) => ({ ...current, [automation.id]: true }));
        } finally {
            setHistoryLoading((current) => {
                const next = { ...current };
                delete next[automation.id];
                return next;
            });
        }
    }, [history, historyFailed, historyLoading]);

    React.useEffect(() => {
        if (selectedAutomation) void ensureHistory(selectedAutomation);
    }, [ensureHistory, selectedAutomation]);

    const remove = React.useCallback(async (automation: HappyHerdAutomation) => {
        const confirmed = await Modal.confirm(
            t('happyHerd.automations.deleteTitle'),
            t('happyHerd.automations.deleteDescription', { name: automation.name }),
            { confirmText: t('happyHerd.automations.delete'), destructive: true },
        );
        if (!confirmed) return;
        try {
            await automationMachineActions.delete(automation);
            setSelectedAutomationId((current) => current === automation.id ? null : current);
            await refresh();
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableDelete'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        }
    }, [refresh]);

    return (
        <View style={[styles.page, desktop && styles.pageDesktop]}>
            <Stack.Screen options={{ title: t('happyHerd.automations.title') }} />
            {(desktop || !selectedAutomation) && (
            <ScrollView
                style={styles.master}
                contentContainerStyle={styles.masterContent}
                showsVerticalScrollIndicator
            >
            <View style={styles.hero}>
                <View style={styles.heroCopy}>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {t('happyHerd.automations.subtitle')}
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
                    <Text style={styles.label}>{t('happyHerd.automations.machine')}</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.choices}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('happyHerd.automations.machine')}
                    >
                        {editingMachineId ? (
                            formMachine ? (
                                <MachineChoice
                                    machine={formMachine}
                                    selected
                                    disabled
                                />
                            ) : (
                                <Text style={{ color: theme.colors.textSecondary }}>
                                    {editingMachineId}
                                </Text>
                            )
                        ) : createMachineChoices.map((candidate) => (
                            <MachineChoice
                                key={candidate.id}
                                machine={candidate}
                                selected={candidate.id === machineId}
                                disabled={!isMachineOnline(candidate)}
                                onSelect={selectCreateMachine}
                            />
                        ))}
                    </ScrollView>
                    <Field label={t('happyHerd.automations.name')} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
                    <Text style={styles.label}>{t('happyHerd.automations.rail')}</Text>
                    <View style={styles.choices}>
                        {(execSupported
                            ? (['claude', 'codex', 'exec'] as const)
                            : (['claude', 'codex'] as const)
                        ).map((rail) => (
                            <Choice
                                key={rail}
                                value={rail}
                                label={rail === 'exec' ? t('happyHerd.automations.railExec') : rail}
                                selected={draft.rail === rail}
                                onSelect={(next) => setDraft((current) => ({
                                    ...current,
                                    rail: next,
                                    kind: next === 'exec' ? 'scheduled' : current.kind,
                                }))}
                            />
                        ))}
                    </View>
                    {draft.rail === 'exec' ? (
                        <>
                            <Field label={t('happyHerd.automations.executable')} value={draft.executable} onChangeText={(executable) => setDraft((current) => ({ ...current, executable }))} />
                            <Field
                                label={t('happyHerd.automations.arguments')}
                                value={draft.arguments}
                                multiline
                                placeholder={t('happyHerd.automations.argumentsHint')}
                                onChangeText={(argumentsValue) => setDraft((current) => ({ ...current, arguments: argumentsValue }))}
                            />
                        </>
                    ) : (
                        <>
                            <Field label={t('happyHerd.automations.instruction')} value={draft.instruction} multiline onChangeText={(instruction) => setDraft((current) => ({ ...current, instruction }))} />
                            <Text style={styles.label}>{t('happyHerd.automations.kind')}</Text>
                            <View style={styles.choices}>
                                {(['scheduled', 'memory-maintenance'] as const).map((kind) => (
                                    <Choice
                                        key={kind}
                                        value={kind}
                                        label={happyHerdAutomationKindLabel(kind, translateAutomation)}
                                        selected={draft.kind === kind}
                                        onSelect={(next) => setDraft((current) => ({ ...current, kind: next }))}
                                    />
                                ))}
                            </View>
                        </>
                    )}
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
                    {draft.rail !== 'exec' && (
                        <>
                            <Text style={styles.label}>{t('happyHerd.automations.commander')}</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                                <Choice value={t('happyHerd.automations.none')} selected={draft.commanderId === null} onSelect={() => setDraft((current) => ({ ...current, commanderId: null }))} />
                                {commanders.map((commander) => (
                                    <Choice key={commander.id} value={commander.name} selected={draft.commanderId === commander.id} onSelect={() => setDraft((current) => ({ ...current, commanderId: commander.id, workspace: commander.workspace }))} />
                                ))}
                            </ScrollView>
                        </>
                    )}
                    <View style={desktop ? styles.twoColumns : undefined}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>{t('happyHerd.automations.initialState')}</Text>
                            <View style={styles.choices}>
                                {(['paused', 'active'] as const).map((status) => (
                                    <Choice
                                        key={status}
                                        value={status}
                                        label={t(
                                            status === 'active'
                                                ? 'happyHerd.automations.statusActive'
                                                : 'happyHerd.automations.statusPaused',
                                        )}
                                        selected={draft.status === status}
                                        onSelect={(next) => setDraft((current) => ({ ...current, status: next }))}
                                    />
                                ))}
                            </View>
                        </View>
                        {draft.rail !== 'exec' && (
                            <View style={{ flex: 1 }}><Field label={t('happyHerd.automations.spawnRetries')} value={draft.maxRetries} onChangeText={(maxRetries) => setDraft((current) => ({ ...current, maxRetries }))} /></View>
                        )}
                    </View>
                    <Pressable
                        disabled={saving || !formMachineOnline}
                        style={[
                            styles.primaryButton,
                            styles.saveButton,
                            { backgroundColor: theme.colors.text },
                            !formMachineOnline && styles.buttonDisabled,
                        ]}
                        onPress={() => void save()}
                    >
                        {saving ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={[styles.buttonText, { color: theme.colors.surface }]}>{t('happyHerd.automations.save')}</Text>}
                    </Pressable>
                </View>
            )}

            {!formVisible && (
                <View style={styles.list}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('happyHerd.automations.tagFilters')}
                        contentContainerStyle={styles.filterChips}
                    >
                        <FilterChip
                            label={t('happyHerd.automations.allTags')}
                            selected={selectedTag === null}
                            onSelect={() => setSelectedTag(null)}
                        />
                        {tags.map((tag) => (
                            <FilterChip
                                key={tag}
                                label={tag}
                                selected={selectedTag === tag}
                                onSelect={() => setSelectedTag(tag)}
                            />
                        ))}
                    </ScrollView>

                    <TextInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={t('happyHerd.automations.searchPlaceholder')}
                        accessibilityLabel={t('happyHerd.automations.searchPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        style={[
                            styles.search,
                            {
                                color: theme.colors.text,
                                borderColor: theme.colors.divider,
                                backgroundColor: theme.colors.surfaceHigh,
                            },
                        ]}
                    />

                    <View style={styles.machineBar}>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.choices}
                            accessibilityRole="radiogroup"
                            accessibilityLabel={t('happyHerd.automations.machine')}
                        >
                            {onlineMachines.map((candidate) => (
                                <MachineChoice
                                    key={candidate.id}
                                    machine={candidate}
                                    selected={candidate.id === machineId}
                                    onSelect={selectBrowseMachine}
                                />
                            ))}
                        </ScrollView>
                        <Text style={[styles.count, { color: theme.colors.textSecondary }]}>
                            {t('happyHerd.automations.automationCount', { count: filteredAutomations.length })}
                        </Text>
                    </View>

                    {!loading && automations.length === 0 && (
                        <View style={[styles.empty, { borderColor: theme.colors.divider }]}>
                            <Ionicons name="time-outline" size={32} color={theme.colors.textSecondary} />
                            <Text style={styles.sectionTitle}>{t('happyHerd.automations.emptyTitle')}</Text>
                            <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.automations.emptySubtitle')}</Text>
                        </View>
                    )}
                    {!loading && automations.length > 0 && filteredAutomations.length === 0 && (
                        <View style={[styles.empty, { borderColor: theme.colors.divider }]}>
                            <Ionicons name="search-outline" size={30} color={theme.colors.textSecondary} />
                            <Text style={{ color: theme.colors.textSecondary }}>
                                {t('happyHerd.automations.noMatches')}
                            </Text>
                        </View>
                    )}
                    {filteredAutomations.length > 0 && (
                        <View
                            accessibilityLabel={t('happyHerd.automations.listLabel')}
                            style={[styles.automationList, { borderColor: theme.colors.divider }]}
                        >
                            {filteredAutomations.map((automation) => {
                                const selected = automation.id === selectedAutomationId;
                                const schedule = happyHerdAutomationRowMeta(
                                    automation,
                                    translateAutomation,
                                    getCurrentLanguage(),
                                );
                                return (
                                    <Pressable
                                        key={automation.id}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected }}
                                        accessibilityLabel={t('happyHerd.automations.openDetails', { name: automation.name })}
                                        onPress={() => selectAutomation(automation.id)}
                                        style={({ pressed }) => [
                                            styles.automationRow,
                                            { borderBottomColor: theme.colors.divider },
                                            selected && {
                                                backgroundColor: theme.colors.surfaceHigh,
                                                borderLeftColor: theme.colors.text,
                                            },
                                            pressed && styles.rowPressed,
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.statusDot,
                                                {
                                                    backgroundColor: automation.status === 'active'
                                                        ? '#34C759'
                                                        : theme.colors.textSecondary,
                                                },
                                            ]}
                                        />
                                        <View style={styles.rowCopy}>
                                            <Text style={styles.rowTitle} numberOfLines={1}>{automation.name}</Text>
                                            <Text style={[styles.rowMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                                {schedule} · {automation.timezone}
                                            </Text>
                                        </View>
                                        <Text style={[styles.rowState, { color: theme.colors.textSecondary }]}>
                                            {t(
                                                automation.status === 'active'
                                                    ? 'happyHerd.automations.statusActive'
                                                    : 'happyHerd.automations.statusPaused',
                                            )}
                                        </Text>
                                        <Ionicons name="chevron-forward" size={17} color={theme.colors.textSecondary} />
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}
                </View>
            )}
            </ScrollView>
            )}

            {selectedAutomation && (
                <HappyHerdAutomationDetail
                    automation={selectedAutomation}
                    machineName={machine ? happyHerdAutomationMachineName(machine) : selectedAutomation.machineId}
                    history={history[selectedAutomation.id]}
                    historyLoading={historyLoading[selectedAutomation.id] === true}
                    historyFailed={historyFailed[selectedAutomation.id] === true}
                    mobile={!desktop}
                    onBack={() => setSelectedAutomationId(null)}
                    onClose={() => setSelectedAutomationId(null)}
                    onRunNow={() => void runNow(selectedAutomation)}
                    onEdit={() => openEdit(selectedAutomation)}
                    onToggleStatus={() => void toggleStatus(selectedAutomation)}
                    onDelete={() => void remove(selectedAutomation)}
                    onOpenSession={navigateToSession}
                    onRetryHistory={() => void ensureHistory(selectedAutomation, true)}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { flex: 1, width: '100%', flexDirection: 'row' },
    pageDesktop: { maxWidth: 1400, alignSelf: 'center' },
    master: { minWidth: 0, flex: 1 },
    masterContent: { padding: 22, paddingBottom: 80, gap: 16 },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    heroCopy: { flex: 1, gap: 6 },
    subtitle: { fontSize: 15, lineHeight: 21, maxWidth: 680 },
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
    list: { gap: 16 },
    filterChips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    filterChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    filterChipText: { fontSize: 14 },
    search: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 14, fontSize: 15, ...Typography.default() },
    machineBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
    count: { flexShrink: 0, fontSize: 12 },
    automationList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
    automationRow: { minHeight: 72, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderLeftColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowPressed: { opacity: 0.72 },
    rowCopy: { minWidth: 0, flex: 1 },
    rowTitle: { fontSize: 16, ...Typography.default('semiBold') },
    rowMeta: { marginTop: 3, fontSize: 13 },
    rowState: { fontSize: 12 },
    empty: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 28, alignItems: 'center', gap: 8 },
}));
