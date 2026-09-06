import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import {
    getAdvertisedDefaultOptionKey,
    groupModelModesByProvider,
    getEffortLevelsForModel,
    getHardcodedModelModes,
    getHardcodedPermissionModes,
    filterPermissionModesForCli,
    getMachineAdvertisedEffortLevels,
    getMachineAdvertisedModels,
    getMachineAdvertisedPermissionModes,
    type ModeOption,
} from '@/components/modelModeOptions';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useAllMachines, useSettingMutable } from '@/sync/storage';
import {
    agentKeys,
    getAgentDefaultOverrideValue,
    hasAgentDefaultOverride,
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
    setAgentDefaultOverride,
    type AgentDefaultField,
    type AgentKey,
} from '@/sync/agentDefaults';
import { getRigMachineSessionCreation } from '@/sync/rigSessionCreation';
import { getMachineName } from '@/sync/machineChoices';
import { getHarnessName } from '@/utils/harnessCatalog';
import { isMachineOnline } from '@/utils/machineUtils';
import { findPreferredAvailableOptionIndex } from '@/utils/newSessionModeSelection';
import { formatLastSeen } from '@/utils/sessionUtils';
import { t } from '@/text';

type ExpandedField = {
    agent: AgentKey;
    field: AgentDefaultField;
} | null;

type FieldConfig = {
    field: AgentDefaultField;
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    options: ModeOption[];
    codeDefaultKey: string | null;
    effectiveValue: string | null;
};

function optionName(options: ModeOption[], key: string | null | undefined): string {
    if (!key) return 'none';
    return options.find((option) => option.key === key)?.name ?? key;
}

export default function AgentDefaultsSettingsScreen() {
    const { theme } = useUnistyles();
    const [agentDefaultOverrides, setAgentDefaultOverrides] = useSettingMutable('agentDefaultOverrides');
    const draftMachineId = useNewSessionDraft((state) => state.selectedMachineId);
    const machines = useAllMachines({ includeOffline: true });
    const sortedMachines = React.useMemo(() => [...machines].sort((left, right) => (
        Number(isMachineOnline(right)) - Number(isMachineOnline(left))
        || (right.activeAt ?? 0) - (left.activeAt ?? 0)
        || left.id.localeCompare(right.id)
    )), [machines]);
    const [catalogMachineId, setCatalogMachineId] = React.useState<string | null>(draftMachineId);
    const [machinePickerExpanded, setMachinePickerExpanded] = React.useState(false);
    const selectedMachine = machines.find((machine) => machine.id === catalogMachineId) ?? null;
    const [expanded, setExpanded] = React.useState<ExpandedField>(null);

    React.useEffect(() => {
        if (catalogMachineId && machines.some((machine) => machine.id === catalogMachineId)) return;
        const draftMachine = draftMachineId
            ? machines.find((machine) => machine.id === draftMachineId)
            : null;
        setCatalogMachineId(draftMachine?.id ?? sortedMachines[0]?.id ?? null);
    }, [catalogMachineId, draftMachineId, machines, sortedMachines]);

    const selectCatalogMachine = React.useCallback((machineId: string) => {
        setCatalogMachineId(machineId);
        setMachinePickerExpanded(false);
        setExpanded(null);
    }, []);

    const selectedMachineName = selectedMachine ? getMachineName(selectedMachine) : null;
    const selectedMachineStatus = selectedMachine
        ? isMachineOnline(selectedMachine)
            ? t('status.online')
            : t('status.lastSeen', { time: formatLastSeen(selectedMachine.activeAt, false) })
        : null;

    const updateOverride = React.useCallback((
        agent: AgentKey,
        field: AgentDefaultField,
        value: string | null,
    ) => {
        setAgentDefaultOverrides(setAgentDefaultOverride(agentDefaultOverrides, agent, field, value));
    }, [agentDefaultOverrides, setAgentDefaultOverrides]);

    const renderOption = (
        agent: AgentKey,
        field: AgentDefaultField,
        title: string,
        subtitle: string | undefined,
        selected: boolean,
        value: string | null,
        disabled = false,
    ) => (
        <Item
            key={`${agent}-${field}-${value ?? 'default'}`}
            title={title}
            subtitle={subtitle}
            disabled={disabled}
            onPress={disabled ? undefined : () => updateOverride(agent, field, value)}
            showChevron={false}
            rightElement={selected ? (
                <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />
            ) : undefined}
        />
    );

    const renderField = (agent: AgentKey, config: FieldConfig) => {
        const overrideValue = getAgentDefaultOverrideValue(agentDefaultOverrides, agent, config.field);
        const hasOverride = hasAgentDefaultOverride(agentDefaultOverrides, agent, config.field);
        const isExpanded = expanded?.agent === agent && expanded.field === config.field;
        const hasSupportedOverride = hasOverride
            && config.options.some((option) => option.key === overrideValue && !option.disabled && !option.unavailable);
        const detail = hasSupportedOverride
            ? optionName(config.options, overrideValue)
            : `Default (${optionName(config.options, config.effectiveValue)})`;
        const codeDefaultLabel = optionName(config.options, config.codeDefaultKey);

        return (
            <React.Fragment key={`${agent}-${config.field}`}>
                <Item
                    title={config.title}
                    detail={detail}
                    icon={<Ionicons name={config.icon} size={29} color="#5856D6" />}
                    onPress={() => setExpanded(isExpanded ? null : { agent, field: config.field })}
                />
                {isExpanded && (
                    <>
                        {renderOption(
                            agent,
                            config.field,
                            t('common.reset'),
                            codeDefaultLabel ? codeDefaultLabel : undefined,
                            !hasSupportedOverride,
                            null,
                        )}
                        {(config.field === 'modelMode'
                            ? groupModelModesByProvider(config.options)
                            : [{ key: config.field, title: null, models: config.options }]
                        ).map((group) => (
                            <React.Fragment key={group.key}>
                                {group.title && <Item title={group.title} showChevron={false} />}
                                {group.models.map((option) => renderOption(
                                    agent,
                                    config.field,
                                    option.name,
                                    option.description ?? undefined,
                                    hasSupportedOverride && overrideValue === option.key,
                                    option.key,
                                    option.disabled || option.unavailable,
                                ))}
                            </React.Fragment>
                        ))}
                    </>
                )}
            </React.Fragment>
        );
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t("uiCopy.agentDefaults")}
            >
                <Item
                    title={t("uiCopy.clearOverrides")}
                    subtitle={t("uiCopy.returnEveryAgentToCodeDefaults")}
                    icon={<Ionicons name="refresh-outline" size={29} color="#FF9500" />}
                    onPress={() => setAgentDefaultOverrides({})}
                    disabled={Object.keys(agentDefaultOverrides).length === 0}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup
                title={t('agentDefaults.capabilitySource')}
                footer={t('agentDefaults.capabilitySourceDescription')}
            >
                <Item
                    title={t('machine.machineGroup')}
                    detail={selectedMachineName ?? t('workspace.selectMachine')}
                    subtitle={selectedMachine
                        ? `${selectedMachine.id} · ${selectedMachineStatus}`
                        : t('workspace.noMachines')}
                    subtitleLines={0}
                    icon={<Ionicons name="desktop-outline" size={29} color="#5856D6" />}
                    onPress={sortedMachines.length > 0
                        ? () => {
                            setMachinePickerExpanded((value) => !value);
                            setExpanded(null);
                        }
                        : undefined}
                    showChevron={sortedMachines.length > 0}
                />
                {machinePickerExpanded && sortedMachines.map((machine) => {
                    const online = isMachineOnline(machine);
                    return (
                        <Item
                            key={machine.id}
                            title={getMachineName(machine)}
                            subtitle={`${machine.id} · ${online
                                ? t('status.online')
                                : t('status.lastSeen', { time: formatLastSeen(machine.activeAt, false) })}`}
                            subtitleLines={0}
                            onPress={() => selectCatalogMachine(machine.id)}
                            showChevron={false}
                            rightElement={machine.id === catalogMachineId ? (
                                <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />
                            ) : undefined}
                        />
                    );
                })}
            </ItemGroup>

            {agentKeys.map((agent) => {
                const rigCreation = agent === 'rig'
                    ? getRigMachineSessionCreation(selectedMachine?.metadata)
                    : null;
                const machineCatalog = agent === 'rig'
                    ? undefined
                    : selectedMachine?.metadata?.agentCapabilities?.[agent];
                const catalogOwned = Boolean(rigCreation || machineCatalog);
                const codeDefaults = resolveAgentDefaultConfig(undefined, agent);
                const configuredDefaults = resolveAgentDefaultConfig(agentDefaultOverrides, agent);
                const permissionOptions: ModeOption[] = rigCreation?.permissionModes
                    ?? (machineCatalog
                        ? getMachineAdvertisedPermissionModes(selectedMachine?.metadata, agent, t)
                        : filterPermissionModesForCli(
                            getHardcodedPermissionModes(agent, t),
                            selectedMachine?.metadata?.happyCliVersion,
                        ));
                const permissionDefault = rigCreation?.defaultPermissionMode
                    ?? (machineCatalog
                        ? getAdvertisedDefaultOptionKey(permissionOptions)
                        : codeDefaults.permissionMode);
                const effectivePermission = permissionOptions[
                    findPreferredAvailableOptionIndex(permissionOptions, [
                        configuredDefaults.permissionMode,
                        permissionDefault,
                    ])
                ]?.key ?? null;
                const resetPermission = permissionOptions[
                    findPreferredAvailableOptionIndex(permissionOptions, [
                        codeDefaults.permissionMode,
                        permissionDefault,
                    ])
                ]?.key ?? null;
                const machineModels: ModeOption[] = rigCreation?.models
                    ?? (machineCatalog
                        ? getMachineAdvertisedModels(selectedMachine?.metadata, agent, t, configuredDefaults.modelMode)
                        : getHardcodedModelModes(agent, t));
                const modelOptions = catalogOwned
                    ? machineModels
                    : machineModels.filter((option) => option.key !== 'default');
                const modelDefault = rigCreation?.defaultModelKey
                    ?? (machineCatalog
                        ? getAdvertisedDefaultOptionKey(modelOptions)
                        : codeDefaults.modelMode);
                const availableModel = modelOptions[
                    findPreferredAvailableOptionIndex(modelOptions, [
                        configuredDefaults.modelMode,
                        modelDefault,
                    ])
                ] ?? null;
                const effectiveModel = availableModel?.key ?? null;
                const resetModel = catalogOwned
                    ? modelOptions[
                        findPreferredAvailableOptionIndex(modelOptions, [
                            codeDefaults.modelMode,
                            modelDefault,
                        ])
                    ]?.key ?? null
                    : codeDefaults.modelMode;
                const effortOptions = rigCreation
                    ? rigCreation.effortsForModel(effectiveModel).map((key) => ({ key, name: key }))
                    : machineCatalog
                        ? getMachineAdvertisedEffortLevels(
                            selectedMachine?.metadata,
                            agent,
                            effectiveModel ?? 'default',
                        )
                        : getEffortLevelsForModel(agent, effectiveModel ?? 'default');
                const effortDefault = rigCreation?.defaultEffortForModel(effectiveModel)
                    ?? (machineCatalog
                        ? getAdvertisedDefaultOptionKey(effortOptions)
                        : resolveAgentDefaultEffortLevel(undefined, agent, effortOptions));
                const configuredEffort = resolveAgentDefaultEffortLevel(
                    agentDefaultOverrides,
                    agent,
                    effortOptions,
                );
                const effectiveEffort = effortOptions[
                    findPreferredAvailableOptionIndex(effortOptions, [configuredEffort, effortDefault])
                ]?.key ?? null;
                const resetEffort = effortOptions[
                    findPreferredAvailableOptionIndex(effortOptions, [
                        resolveAgentDefaultEffortLevel(undefined, agent, effortOptions),
                        effortDefault,
                    ])
                ]?.key ?? null;
                const fields: FieldConfig[] = [
                    ...(permissionOptions.length > 0 ? [{
                        field: 'permissionMode',
                        title: t("uiCopy.permission"),
                        icon: 'shield-checkmark-outline',
                        options: permissionOptions,
                        codeDefaultKey: resetPermission,
                        effectiveValue: effectivePermission,
                    } as const] : []),
                    ...(modelOptions.length > 0 ? [{
                        field: 'modelMode' as const,
                        title: t("uiCopy.model"),
                        icon: 'hardware-chip-outline' as const,
                        options: modelOptions,
                        codeDefaultKey: resetModel,
                        effectiveValue: effectiveModel,
                    }] : []),
                    ...(effortOptions.length > 0 ? [{
                        field: 'effortLevel' as const,
                        title: t("uiCopy.effort"),
                        icon: 'speedometer-outline' as const,
                        options: effortOptions,
                        codeDefaultKey: resetEffort,
                        effectiveValue: effectiveEffort,
                    }] : []),
                ];
                const machineOwned = agent === 'grok' || agent === 'dsh' || agent === 'rig';
                const ownsAuthoritativeCatalog = agent === 'rig'
                    ? rigCreation !== null
                    : machineCatalog !== undefined;
                const providerFooter = machineOwned
                    ? !selectedMachineName
                        ? t('agentDefaults.selectMachineForProvider')
                        : ownsAuthoritativeCatalog
                            ? t('agentDefaults.capabilitiesFromMachine', { machine: selectedMachineName })
                            : t('agentDefaults.providerUnavailableOnMachine', { machine: selectedMachineName })
                    : undefined;
                const unavailableTitle = selectedMachine
                    ? t('agentDefaults.providerUnavailable')
                    : t('agentDefaults.selectCapabilityMachine');
                const unavailableSubtitle = sortedMachines.length === 0
                    ? t('agentDefaults.noMachinesForCapabilities')
                    : selectedMachineName
                        ? t('agentDefaults.providerUnavailableOnMachine', { machine: selectedMachineName })
                        : t('agentDefaults.selectMachineForProvider');

                return (
                    <ItemGroup key={agent} title={getHarnessName(agent)} footer={providerFooter}>
                        {fields.length > 0
                            ? fields.map((field) => renderField(agent, field))
                            : (
                                <Item
                                    title={unavailableTitle}
                                    subtitle={unavailableSubtitle}
                                    subtitleLines={0}
                                    icon={<Ionicons name="alert-circle-outline" size={29} color={theme.colors.textSecondary} />}
                                    onPress={sortedMachines.length > 0
                                        ? () => {
                                            setMachinePickerExpanded(true);
                                            setExpanded(null);
                                        }
                                        : undefined}
                                    showChevron={sortedMachines.length > 0}
                                />
                            )}
                    </ItemGroup>
                );
            })}
        </ItemList>
    );
}
