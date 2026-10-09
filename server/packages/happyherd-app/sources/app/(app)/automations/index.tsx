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
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {
    HappyHerdAutomation,
    HappyHerdAutomationBlockedRun,
    HappyHerdAutomationCreateInput,
    HappyHerdAutomationRun,
    HappyHerdCommanderSummary,
} from '@happyherd/wire';

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
import { HerdSegmentedControl } from '@/components/herd/SegmentedControl';
import {
    HerdButton,
    HerdChip,
    HerdEmptyState,
    HerdNotice,
    HerdPageHeader,
    HerdSectionLabel,
} from '@/components/herd/pages/HerdPage';
import { HerdSheet } from '@/components/herd/pages/HerdSheet';
import { HerdCollapse } from '@/components/herd/pages/HerdCollapse';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';
import { Modal } from '@/modal';
import {
    machineAutomationHistory,
    machineStopAutomationRun,
    machineAbandonAutomationRun,
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

function MachineChip({
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
    const online = isMachineOnline(machine);
    return (
        <HerdChip
            mono
            label={happyHerdAutomationMachineName(machine)}
            selected={selected}
            disabled={disabled}
            onPress={() => onSelect?.(machine.id)}
            leading={(
                <View style={[
                    styles.statusDot,
                    online
                        ? { backgroundColor: theme.colors.diff.success }
                        : { backgroundColor: theme.colors.divider },
                ]} />
            )}
        />
    );
}

function Field({
    label,
    value,
    onChangeText,
    multiline = false,
    placeholder,
    editable = true,
    mono = false,
    hint,
}: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    multiline?: boolean;
    placeholder?: string;
    editable?: boolean;
    mono?: boolean;
    hint?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.field}>
            <HerdSectionLabel first>{label}</HerdSectionLabel>
            <TextInput
                accessibilityLabel={label}
                value={value}
                onChangeText={onChangeText}
                multiline={multiline}
                placeholder={placeholder}
                editable={editable}
                placeholderTextColor={theme.colors.input.placeholder}
                style={[
                    styles.input,
                    mono && styles.inputMono,
                    multiline && styles.multiline,
                    !editable && styles.inputDisabled,
                ]}
            />
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
    );
}

export default function AutomationsScreen() {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const routeParams = useLocalSearchParams<{ machineId?: string; automationId?: string }>();
    const appliedTargetRef = React.useRef<string | null>(null);
    const { width } = useWindowDimensions();
    const desktop = width >= 900;
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
    const [stopRequestedRunId, setStopRequestedRunId] = React.useState<string | null>(null);
    const [resolvingBlock, setResolvingBlock] = React.useState<string | null>(null);
    const [freshRunId, setFreshRunId] = React.useState<string | null>(null);
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
    React.useEffect(() => {
        const targetMachineId = routeParams.machineId;
        const targetAutomationId = routeParams.automationId;
        if (typeof targetMachineId !== 'string' || typeof targetAutomationId !== 'string') return;
        const targetKey = JSON.stringify([targetMachineId, targetAutomationId]);
        if (appliedTargetRef.current === targetKey) return;
        const collection = machineCollections.find((item) => item.machine.id === targetMachineId);
        if (!collection?.automations.some((item) => item.id === targetAutomationId)) return;
        appliedTargetRef.current = targetKey;
        setMachineId(targetMachineId);
        setSelectedTag(null);
        setSearchQuery('');
        setSelectedAutomationId(targetAutomationId);
    }, [machineCollections, routeParams.machineId, routeParams.automationId]);

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

    const toggleAutomation = React.useCallback((automationId: string) => {
        if (selectedAutomationId === automationId) {
            setSelectedAutomationId(null);
            return;
        }
        setHistoryFailed((current) => {
            if (!current[automationId]) return current;
            const next = { ...current };
            delete next[automationId];
            return next;
        });
        setSelectedAutomationId(automationId);
    }, [selectedAutomationId]);

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

    const closeForm = React.useCallback(() => {
        setFormVisible(false);
        setEditingId(null);
        setEditingMachineId(null);
    }, []);

    const commanderNames = React.useMemo(
        () => new Map(commanders.map((commander) => [commander.id, commander.name])),
        [commanders],
    );

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
            setFreshRunId(run.id);
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

    const resolveBlockingRun = React.useCallback(async (
        automation: HappyHerdAutomation,
        blockedRun: HappyHerdAutomationBlockedRun,
        abandon: boolean,
    ) => {
        if (abandon) {
            const confirmed = await Modal.confirm(
                t('happyHerd.automations.abandonBlockingRun'),
                t('happyHerd.automations.abandonDescription', { id: blockedRun.runId }),
                { confirmText: t('happyHerd.automations.abandonBlockingRun'), destructive: true },
            );
            if (!confirmed) return;
        }
        setResolvingBlock(blockedRun.runId);
        try {
            if (abandon) {
                await machineAbandonAutomationRun(automation.machineId, {
                    automationId: automation.id, runId: blockedRun.runId,
                    sessionId: blockedRun.sessionId, confirmation: 'ABANDON',
                });
            } else {
                await machineStopAutomationRun(automation.machineId, { automationId: automation.id, runId: blockedRun.runId });
                setStopRequestedRunId(blockedRun.runId);
            }
            await refresh();
            await ensureHistory(automation, true);
        } catch (nextError) {
            Modal.alert(t('happyHerd.automations.unableResolveBlock'), nextError instanceof Error ? nextError.message : t('happyHerd.automations.unknownError'));
        } finally {
            setResolvingBlock(null);
        }
    }, [ensureHistory, refresh]);

    const formOpenInline = formVisible && !desktop;
    const formTitle = editingId ? t('happyHerd.automations.edit') : t('happyHerd.automations.create');
    const canCreate = !!machine && isMachineOnline(machine);

    const formFields = (
        <View testID="automation-form" style={styles.formFields}>
            <View style={styles.field}>
                <HerdSectionLabel first>{t('happyHerd.automations.machine')}</HerdSectionLabel>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.choices}
                    accessibilityRole="radiogroup"
                    accessibilityLabel={t('happyHerd.automations.machine')}
                >
                    {editingMachineId ? (
                        formMachine ? (
                            <MachineChip
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
                        <MachineChip
                            key={candidate.id}
                            machine={candidate}
                            selected={candidate.id === machineId}
                            disabled={!isMachineOnline(candidate)}
                            onSelect={selectCreateMachine}
                        />
                    ))}
                </ScrollView>
            </View>
            <Field label={t('happyHerd.automations.name')} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
            <View style={styles.field}>
                <HerdSectionLabel first>{t('happyHerd.automations.rail')}</HerdSectionLabel>
                <HerdSegmentedControl
                    accessibilityLabel={t('happyHerd.automations.rail')}
                    options={(execSupported
                        ? (['claude', 'codex', 'exec'] as const)
                        : (['claude', 'codex'] as const)
                    ).map((rail) => ({
                        value: rail,
                        label: rail === 'exec' ? t('happyHerd.automations.railExec') : rail,
                    }))}
                    value={draft.rail}
                    onChange={(next) => setDraft((current) => ({
                        ...current,
                        rail: next,
                        kind: next === 'exec' ? 'scheduled' : current.kind,
                    }))}
                />
            </View>
            {draft.rail === 'exec' ? (
                <View style={desktop ? styles.twoColumns : styles.stack}>
                    <View style={styles.column}>
                        <Field mono label={t('happyHerd.automations.executable')} value={draft.executable} onChangeText={(executable) => setDraft((current) => ({ ...current, executable }))} />
                    </View>
                    <View style={styles.column}>
                        <Field
                            mono
                            label={t('happyHerd.automations.arguments')}
                            value={draft.arguments}
                            multiline
                            placeholder={t('happyHerd.automations.argumentsHint')}
                            onChangeText={(argumentsValue) => setDraft((current) => ({ ...current, arguments: argumentsValue }))}
                        />
                    </View>
                </View>
            ) : (
                <>
                    <Field label={t('happyHerd.automations.instruction')} value={draft.instruction} multiline onChangeText={(instruction) => setDraft((current) => ({ ...current, instruction }))} />
                    <View style={styles.field}>
                        <HerdSectionLabel first>{t('happyHerd.automations.kind')}</HerdSectionLabel>
                        <HerdSegmentedControl
                            accessibilityLabel={t('happyHerd.automations.kind')}
                            options={(['scheduled', 'memory-maintenance'] as const).map((kind) => ({
                                value: kind,
                                label: happyHerdAutomationKindLabel(kind, translateAutomation),
                            }))}
                            value={draft.kind === 'memory-maintenance' ? 'memory-maintenance' : 'scheduled'}
                            onChange={(next) => setDraft((current) => ({ ...current, kind: next }))}
                        />
                    </View>
                </>
            )}
            <View style={desktop ? styles.twoColumns : styles.stack}>
                <View style={styles.column}><Field mono label={t('happyHerd.automations.cron')} value={draft.schedule} onChangeText={(schedule) => setDraft((current) => ({ ...current, schedule }))} /></View>
                <View style={styles.column}><Field mono label={t('happyHerd.automations.timezone')} value={draft.timezone} onChangeText={(timezone) => setDraft((current) => ({ ...current, timezone }))} /></View>
            </View>
            <Field mono label={t('happyHerd.automations.workspace')} value={draft.workspace} onChangeText={(workspace) => setDraft((current) => ({ ...current, workspace }))} />
            <Field
                label={t('happyHerd.automations.tags')}
                value={draft.tags}
                multiline
                editable={tagsSupported}
                placeholder={t('happyHerd.automations.tagsHint')}
                onChangeText={(tags) => setDraft((current) => ({ ...current, tags }))}
            />
            {!tagsSupported && (
                <Text style={styles.hint}>
                    {t('happyHerd.automations.tagsRequiresUpgrade')}
                </Text>
            )}
            {draft.rail !== 'exec' && (
                <View style={styles.field}>
                    <HerdSectionLabel first>{t('happyHerd.automations.commander')}</HerdSectionLabel>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                        <HerdChip
                            label={t('happyHerd.automations.none')}
                            selected={draft.commanderId === null}
                            onPress={() => setDraft((current) => ({ ...current, commanderId: null }))}
                        />
                        {commanders.map((commander) => (
                            <HerdChip
                                key={commander.id}
                                label={commander.name}
                                selected={draft.commanderId === commander.id}
                                onPress={() => setDraft((current) => ({ ...current, commanderId: commander.id, workspace: commander.workspace }))}
                            />
                        ))}
                    </ScrollView>
                </View>
            )}
            <View style={desktop ? styles.twoColumns : styles.stack}>
                <View style={styles.column}>
                    <HerdSectionLabel first>{t('happyHerd.automations.initialState')}</HerdSectionLabel>
                    <HerdSegmentedControl
                        accessibilityLabel={t('happyHerd.automations.initialState')}
                        options={(['paused', 'active'] as const).map((status) => ({
                            value: status,
                            label: t(
                                status === 'active'
                                    ? 'happyHerd.automations.statusActive'
                                    : 'happyHerd.automations.statusPaused',
                            ),
                        }))}
                        value={draft.status}
                        onChange={(next) => setDraft((current) => ({ ...current, status: next }))}
                    />
                </View>
                {draft.rail !== 'exec' && (
                    <View style={styles.column}><Field mono label={t('happyHerd.automations.spawnRetries')} value={draft.maxRetries} onChangeText={(maxRetries) => setDraft((current) => ({ ...current, maxRetries }))} /></View>
                )}
            </View>
        </View>
    );

    const formActions = (
        <>
            <HerdButton label={t('common.cancel')} onPress={closeForm} />
            <HerdButton
                variant="primary"
                label={t('happyHerd.automations.save')}
                loading={saving}
                disabled={saving || !formMachineOnline}
                onPress={() => void save()}
            />
        </>
    );

    return (
        <View style={styles.page}>
            {/* Wide layouts draw the mock's large title in the page, so the header bar would repeat it. */}
            <Stack.Screen options={{ title: t('happyHerd.automations.title'), headerShown: !desktop }} />
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.content, !desktop && styles.contentCompact]}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
            >
                <HerdPageHeader
                    compact={!desktop}
                    title={desktop ? t('happyHerd.automations.title') : undefined}
                    subtitle={t('happyHerd.automations.subtitle')}
                    actions={!formOpenInline ? (
                        <HerdButton
                            variant="primary"
                            icon="add"
                            label={t('happyHerd.automations.new')}
                            disabled={!canCreate}
                            onPress={openCreate}
                        />
                    ) : undefined}
                />

                <View style={styles.notices}>
                    {error && <HerdNotice message={error} />}
                    {machineFailures.map((failure) => (
                        <HerdNotice
                            key={failure.machine.id}
                            tone="error"
                            message={t('happyHerd.automations.machineLoadFailed', {
                                name: happyHerdAutomationMachineName(failure.machine),
                                message: failure.error.message,
                            })}
                        />
                    ))}
                </View>

                {formOpenInline ? (
                    <View style={styles.inlineForm}>
                        <View style={styles.inlineFormHeader}>
                            <Text accessibilityRole="header" style={styles.inlineFormTitle}>{formTitle}</Text>
                            <HerdButton
                                variant="ghost"
                                icon="close"
                                accessibilityLabel={t('common.cancel')}
                                onPress={closeForm}
                            />
                        </View>
                        {formFields}
                        <View style={styles.inlineFormActions}>{formActions}</View>
                    </View>
                ) : (
                    <View style={styles.list}>
                        <View style={[styles.filters, !desktop && styles.filtersCompact]}>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.machineScroller}
                                contentContainerStyle={styles.choices}
                                accessibilityRole="radiogroup"
                                accessibilityLabel={t('happyHerd.automations.machine')}
                            >
                                {onlineMachines.map((candidate) => (
                                    <MachineChip
                                        key={candidate.id}
                                        machine={candidate}
                                        selected={candidate.id === machineId}
                                        onSelect={selectBrowseMachine}
                                    />
                                ))}
                            </ScrollView>
                            <View style={[styles.search, !desktop && styles.searchCompact]}>
                                <Ionicons name="search" size={15} color={theme.colors.textSecondary} />
                                <TextInput
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    placeholder={t('happyHerd.automations.searchPlaceholder')}
                                    accessibilityLabel={t('happyHerd.automations.searchPlaceholder')}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    style={styles.searchInput}
                                />
                            </View>
                        </View>

                        <View style={[styles.tagBar, !desktop && styles.tagBarCompact]}>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.tagScroller}
                                accessibilityRole="radiogroup"
                                accessibilityLabel={t('happyHerd.automations.tagFilters')}
                                contentContainerStyle={styles.choices}
                            >
                                <HerdChip
                                    mono
                                    label={t('happyHerd.automations.allTags')}
                                    selected={selectedTag === null}
                                    onPress={() => setSelectedTag(null)}
                                />
                                {tags.map((tag) => (
                                    <HerdChip
                                        mono
                                        key={tag}
                                        label={tag}
                                        selected={selectedTag === tag}
                                        onPress={() => setSelectedTag(tag)}
                                    />
                                ))}
                                {/* The count reads inline after the chips, as in the mock. */}
                                <Text testID="automations-count" style={styles.count}>
                                    {t('happyHerd.automations.automationCount', { count: filteredAutomations.length })}
                                </Text>
                            </ScrollView>
                        </View>

                        {loading && <ActivityIndicator style={styles.loading} color={theme.colors.textSecondary} />}

                        {!loading && automations.length === 0 && (
                            <HerdEmptyState
                                testID="automations-empty"
                                icon="time-outline"
                                title={t('happyHerd.automations.emptyTitle')}
                                description={t('happyHerd.automations.emptySubtitle')}
                                action={(
                                    <HerdButton
                                        variant="primary"
                                        icon="add"
                                        label={t('happyHerd.automations.create')}
                                        disabled={!canCreate}
                                        onPress={openCreate}
                                    />
                                )}
                            />
                        )}
                        {!loading && automations.length > 0 && filteredAutomations.length === 0 && (
                            <HerdEmptyState
                                icon="search-outline"
                                description={t('happyHerd.automations.noMatches')}
                            />
                        )}
                        {filteredAutomations.length > 0 && (
                            <View
                                accessibilityLabel={t('happyHerd.automations.listLabel')}
                                style={styles.rows}
                            >
                                {filteredAutomations.map((automation, index) => {
                                    const open = automation.id === selectedAutomationId;
                                    const active = automation.status === 'active';
                                    const blockedRun = machineCollections.find((collection) => collection.machine.id === automation.machineId)?.blockedRuns?.find((run) => run.automationId === automation.id);
                                    const statusColor = blockedRun ? theme.colors.status.disconnected : active ? theme.colors.diff.success : theme.colors.textSecondary;
                                    const meta = [
                                        happyHerdAutomationRowMeta(automation, translateAutomation, getCurrentLanguage()),
                                        automation.timezone,
                                        happyHerdAutomationKindLabel(automation.kind, translateAutomation),
                                    ].join(' · ');
                                    return (
                                        <View
                                            key={automation.id}
                                            testID={`automation-row-${automation.id}`}
                                            style={[styles.row(index), open && styles.rowOpen]}
                                        >
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityState={{ expanded: open }}
                                                aria-expanded={open}
                                                accessibilityLabel={t(
                                                    open
                                                        ? 'happyHerd.automations.collapseDetails'
                                                        : 'happyHerd.automations.expandDetails',
                                                    { name: automation.name },
                                                )}
                                                onPress={() => toggleAutomation(automation.id)}
                                                style={({ pressed }) => [styles.rowLine, pressed && styles.rowPressed]}
                                            >
                                                <View
                                                    testID="automation-status-dot"
                                                    style={[
                                                        styles.rowDot,
                                                        { backgroundColor: statusColor },
                                                        active && !blockedRun && styles.rowDotActive,
                                                    ]}
                                                />
                                                <View style={styles.rowCopy}>
                                                    <Text style={styles.rowTitle} numberOfLines={1}>{automation.name}</Text>
                                                    <Text style={[styles.rowMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                                        {meta}
                                                    </Text>
                                                </View>
                                                <Text style={[styles.rowState, {
                                                    color: statusColor,
                                                }]}>
                                                    {t(
                                                        blockedRun
                                                            ? 'happyHerd.automations.statusBlocked'
                                                            : active
                                                            ? 'happyHerd.automations.statusActive'
                                                            : 'happyHerd.automations.statusPaused',
                                                    )}
                                                </Text>
                                                <View style={[styles.chevron, open && styles.chevronOpen]}>
                                                    <Ionicons name="chevron-forward" size={17} color={theme.colors.textSecondary} />
                                                </View>
                                            </Pressable>
                                            <HerdCollapse
                                                open={open}
                                                style={[styles.rowBody, !desktop && styles.rowBodyCompact]}
                                            >
                                                    <HappyHerdAutomationDetail
                                                        automation={automation}
                                                        blockedRun={blockedRun}
                                                        stopRequested={stopRequestedRunId === blockedRun?.runId}
                                                        onRefreshBlock={() => { void refresh(); void ensureHistory(automation, true); }}
                                                        resolvingBlock={resolvingBlock === blockedRun?.runId}
                                                        onStopBlockingRun={() => blockedRun && void resolveBlockingRun(automation, blockedRun, false)}
                                                        onAbandonBlockingRun={() => blockedRun && void resolveBlockingRun(automation, blockedRun, true)}
                                                        machineName={machine ? happyHerdAutomationMachineName(machine) : automation.machineId}
                                                        commanderName={automation.kind !== 'heartbeat' && automation.rail !== 'exec' && automation.commanderId
                                                            ? commanderNames.get(automation.commanderId) ?? null
                                                            : null}
                                                        history={history[automation.id]}
                                                        historyLoading={historyLoading[automation.id] === true}
                                                        historyFailed={historyFailed[automation.id] === true}
                                                        freshRunId={freshRunId}
                                                        onRunNow={() => void runNow(automation)}
                                                        onEdit={() => openEdit(automation)}
                                                        onToggleStatus={() => void toggleStatus(automation)}
                                                        onDelete={() => void remove(automation)}
                                                        onOpenSession={navigateToSession}
                                                        onRetryHistory={() => void ensureHistory(automation, true)}
                                                    />
                                            </HerdCollapse>
                                        </View>
                                    );
                                })}
                            </View>
                        )}
                    </View>
                )}
            </ScrollView>

            {desktop && (
                <HerdSheet
                    visible={formVisible}
                    wide
                    testID="automation-form-sheet"
                    title={formTitle}
                    closeLabel={t('common.cancel')}
                    onClose={closeForm}
                    footer={formActions}
                >
                    {formFields}
                </HerdSheet>
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { flex: 1, width: '100%' },
    scroll: { flex: 1 },
    content: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 34, paddingTop: 28, paddingBottom: 80 },
    // Phones (UI overhaul): the page content sits on the 16 px gutter.
    contentCompact: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 48 },
    notices: { gap: 10, marginBottom: 6 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    choices: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    list: { gap: 12 },
    filters: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    filtersCompact: { flexDirection: 'column', alignItems: 'stretch' },
    machineScroller: { flexGrow: 1, flexShrink: 1 },
    search: {
        width: 300,
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radius,
        backgroundColor: theme.colors.input.background,
    },
    searchCompact: { width: '100%' },
    searchInput: {
        flex: 1,
        minWidth: 0,
        minHeight: 38,
        color: theme.colors.text,
        fontSize: 16,
        ...Typography.default(),
        _web: { outlineStyle: 'none' },
    },
    tagBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tagBarCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
    tagScroller: { flexGrow: 1, flexShrink: 1 },
    count: { flexShrink: 0, alignSelf: 'center', marginLeft: 4, fontSize: 12, color: theme.colors.textSecondary, ...Typography.mono() },
    loading: { marginVertical: 24 },
    rows: { gap: 9 },
    // One style carries the row's web classes: Unistyles merges `_web` objects
    // key by key, and two `_classNames` arrays in one style list do not combine.
    row: (index: number) => ({
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-rise-sm', herdStaggerClass(index)),
            _hover: { borderColor: theme.colors.kilv.rimLine },
        },
    }),
    rowOpen: {
        borderColor: theme.colors.kilv.rimLine,
        _web: { boxShadow: theme.kilv.shadow },
    },
    rowLine: {
        minHeight: 64,
        paddingHorizontal: 18,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        _web: { cursor: 'pointer' },
    },
    rowPressed: { opacity: 0.8 },
    rowDot: { width: 10, height: 10, borderRadius: 5 },
    rowDotActive: { _web: { boxShadow: `0 0 10px ${theme.colors.diff.success}` } },
    rowCopy: { minWidth: 0, flex: 1 },
    rowTitle: { fontSize: 16, ...Typography.default('semiBold') },
    rowMeta: { marginTop: 4, fontSize: 12.5, ...Typography.mono() },
    rowState: { fontSize: 14 },
    chevron: { _web: { _classNames: herdWebClasses('herd-transition') } },
    chevronOpen: { transform: [{ rotate: '90deg' }] },
    rowBody: {
        paddingLeft: 42,
        paddingRight: 18,
        paddingBottom: 18,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    rowBodyCompact: { paddingLeft: 18 },
    inlineForm: {
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        borderRadius: theme.kilv.radiusSheet,
        backgroundColor: theme.colors.surface,
        padding: 16,
        gap: 4,
        _web: { _classNames: herdWebClasses('herd-rise-sm') },
    },
    inlineFormHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
    inlineFormTitle: { flex: 1, fontSize: 19, ...Typography.default('semiBold') },
    inlineFormActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
    formFields: { gap: 16, paddingTop: 4 },
    field: { gap: 0 },
    stack: { gap: 16 },
    twoColumns: { flexDirection: 'row', gap: 18 },
    column: { flex: 1, minWidth: 0 },
    input: {
        minHeight: 40,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radius,
        paddingHorizontal: 12,
        paddingVertical: 9,
        fontSize: 16,
        color: theme.colors.text,
        backgroundColor: theme.colors.input.background,
        ...Typography.default(),
        _web: {
            _classNames: herdWebClasses('herd-transition'),
            _focus: { borderColor: theme.colors.selection.border, outlineStyle: 'none' },
        },
    },
    inputMono: { ...Typography.mono(), fontSize: 15 },
    inputDisabled: { opacity: theme.kilv.disabledOpacity },
    multiline: { minHeight: 104, textAlignVertical: 'top' },
    hint: { marginTop: 6, fontSize: 12.5, lineHeight: 18, color: theme.colors.textSecondary },
}));
