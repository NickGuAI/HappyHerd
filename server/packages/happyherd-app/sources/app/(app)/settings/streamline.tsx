import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';
import {
    getMachineAdvertisedEffortLevels,
    getMachineAdvertisedModels,
    getMachineAdvertisedPermissionModes,
    groupModelModesByProvider,
    type ModeOption,
} from '@/components/modelModeOptions';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import {
    getAgentDefaultOverrideValue,
    setAgentDefaultOverride,
    type AgentDefaultField,
} from '@/sync/agentDefaults';
import { getMachineName } from '@/sync/machineChoices';
import { useAllMachines, useSetting, useSettingMutable } from '@/sync/storage';
import {
    normalizeStreamlineAgent,
    resolveStreamlineSelection,
    STREAMLINE_CODE_DEFAULTS,
    type StreamlineAgent,
} from '@/sync/streamlineDefaults';
import { t } from '@/text';
import { getHarnessName, HARNESS_ORDER } from '@/utils/harnessCatalog';
import { isMachineOnline } from '@/utils/machineUtils';
import { resolveNewSessionMachine } from '@/utils/newSessionMachine';
import { formatLastSeen } from '@/utils/sessionUtils';

/** Agents with their own Streamline defaults; agy and rig launch with their Agent Defaults. */
const STREAMLINE_DEFAULT_AGENTS = HARNESS_ORDER.filter((agent) => agent in STREAMLINE_CODE_DEFAULTS);

type Expanded = { agent: StreamlineAgent; field: AgentDefaultField } | 'machine' | null;

function optionName(options: readonly ModeOption[], key: string | null | undefined): string | null {
    if (!key) return null;
    return options.find((option) => option.key === key)?.name ?? key;
}

function StreamlineSettingsScreen() {
    const { theme } = useUnistyles();
    const [newSessionMode, setNewSessionMode] = useSettingMutable('newSessionMode');
    const [streamlineAgent, setStreamlineAgent] = useSettingMutable('streamlineAgent');
    const [streamlineAgentDefaults, setStreamlineAgentDefaults] = useSettingMutable('streamlineAgentDefaults');
    const [streamlineGithubWorktree, setStreamlineGithubWorktree] = useSettingMutable('streamlineGithubWorktree');
    const agentDefaultOverrides = useSetting('agentDefaultOverrides');
    const draftMachineId = useNewSessionDraft((state) => state.selectedMachineId);
    const machines = useAllMachines({ includeOffline: true });
    const [catalogMachineId, setCatalogMachineId] = React.useState<string | null>(null);
    const [expanded, setExpanded] = React.useState<Expanded>(null);

    // Options come from one exact machine's advertised catalog, like Agent Defaults.
    const catalogMachine = (catalogMachineId && machines.find((machine) => machine.id === catalogMachineId))
        || resolveNewSessionMachine(machines, draftMachineId)?.machine
        || null;
    const defaultAgent = normalizeStreamlineAgent(streamlineAgent);
    const check = <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />;
    const toggle = (next: Expanded) => setExpanded((current) => (
        JSON.stringify(current) === JSON.stringify(next) ? null : next
    ));

    const updateDefault = (agent: StreamlineAgent, field: AgentDefaultField, value: string | null) => {
        setStreamlineAgentDefaults(setAgentDefaultOverride(streamlineAgentDefaults, agent, field, value));
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup title={t('newSession.streamline.modeStreamline')} footer={t('newSession.streamline.settingsSubtitle')}>
                <Item
                    title={t('newSession.streamline.worktreeRuleTitle')}
                    subtitle={t('newSession.streamline.worktreeRuleDescription')}
                    subtitleLines={0}
                    icon={<Ionicons name="git-branch-outline" size={29} color={theme.colors.textLink} />}
                    rightElement={<Switch value={streamlineGithubWorktree} onValueChange={setStreamlineGithubWorktree} />}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('newSession.streamline.defaultModeTitle')}>
                {(['streamline', 'advanced'] as const).map((mode) => (
                    <Item
                        key={mode}
                        title={mode === 'streamline' ? t('newSession.streamline.modeStreamline') : t('newSession.streamline.modeAdvanced')}
                        subtitle={mode === 'streamline' ? t('newSession.streamline.intro') : t('uiCopy.startANewSessionOnAnyOfYourConnectedMachines')}
                        onPress={() => setNewSessionMode(mode)}
                        rightElement={newSessionMode === mode ? check : undefined}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            <ItemGroup title={t('newSession.streamline.defaultAgentTitle')} footer={t('newSession.streamline.defaultAgentDescription')}>
                {HARNESS_ORDER.map((agent) => (
                    <Item
                        key={agent}
                        title={getHarnessName(agent)}
                        onPress={() => setStreamlineAgent(agent)}
                        rightElement={defaultAgent === agent ? check : undefined}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            <ItemGroup title={t('agentDefaults.capabilitySource')} footer={t('agentDefaults.capabilitySourceDescription')}>
                <Item
                    title={t('machine.machineGroup')}
                    detail={catalogMachine ? getMachineName(catalogMachine) : t('workspace.selectMachine')}
                    subtitle={catalogMachine
                        ? `${catalogMachine.id} · ${isMachineOnline(catalogMachine)
                            ? t('status.online')
                            : t('status.lastSeen', { time: formatLastSeen(catalogMachine.activeAt, false) })}`
                        : t('workspace.noMachines')}
                    subtitleLines={0}
                    icon={<Ionicons name="desktop-outline" size={29} color={theme.colors.textLink} />}
                    onPress={machines.length > 0 ? () => toggle('machine') : undefined}
                    showChevron={machines.length > 0}
                />
                {expanded === 'machine' && machines.map((machine) => (
                    <Item
                        key={machine.id}
                        title={getMachineName(machine)}
                        subtitle={`${machine.id} · ${isMachineOnline(machine) ? t('status.online') : t('status.offline')}`}
                        onPress={() => {
                            setCatalogMachineId(machine.id);
                            setExpanded(null);
                        }}
                        rightElement={machine.id === catalogMachine?.id ? check : undefined}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            <ItemGroup title={t('newSession.streamline.agentDefaultsTitle')} footer={t('newSession.streamline.agentDefaultsDescription')}>
                <Item
                    title={t('uiCopy.clearOverrides')}
                    icon={<Ionicons name="refresh-outline" size={29} color={theme.colors.warning} />}
                    onPress={() => setStreamlineAgentDefaults({})}
                    disabled={Object.keys(streamlineAgentDefaults).length === 0}
                    showChevron={false}
                />
            </ItemGroup>

            {STREAMLINE_DEFAULT_AGENTS.map((agent) => {
                const metadata = catalogMachine?.metadata;
                const selection = resolveStreamlineSelection({ agent, machineMetadata: metadata, streamlineAgentDefaults, agentDefaultOverrides });
                const reset = resolveStreamlineSelection({ agent, machineMetadata: metadata, streamlineAgentDefaults: {}, agentDefaultOverrides });
                const permissions = getMachineAdvertisedPermissionModes(metadata, agent, t);
                const models = getMachineAdvertisedModels(metadata, agent, t);
                const efforts = getMachineAdvertisedEffortLevels(metadata, agent, selection.modelMode ?? 'default');
                const fields: Array<{ field: AgentDefaultField; title: string; icon: keyof typeof Ionicons.glyphMap; options: ModeOption[]; value: string | null; resetValue: string | null }> = [
                    { field: 'modelMode', title: t('uiCopy.model'), icon: 'hardware-chip-outline', options: models, value: selection.modelMode, resetValue: reset.modelMode },
                    { field: 'effortLevel', title: t('uiCopy.effort'), icon: 'speedometer-outline', options: efforts, value: selection.effortLevel, resetValue: reset.effortLevel },
                    { field: 'permissionMode', title: t('uiCopy.permission'), icon: 'shield-checkmark-outline', options: permissions, value: selection.permissionMode, resetValue: reset.permissionMode },
                ].filter((entry) => entry.options.length > 0) as any;
                // An empty Streamline model preference follows the machine's catalog default ("Latest").
                const followsLatest = STREAMLINE_CODE_DEFAULTS[agent]?.modelMode === ''
                    && !getAgentDefaultOverrideValue(streamlineAgentDefaults, agent, 'modelMode');

                return (
                    <ItemGroup
                        key={agent}
                        title={getHarnessName(agent)}
                        footer={catalogMachine && fields.length > 0
                            ? t('agentDefaults.capabilitiesFromMachine', { machine: getMachineName(catalogMachine) })
                            : undefined}
                    >
                        {fields.length === 0 ? (
                            <Item
                                title={t('agentDefaults.providerUnavailable')}
                                subtitle={catalogMachine
                                    ? t('agentDefaults.providerUnavailableOnMachine', { machine: getMachineName(catalogMachine) })
                                    : t('agentDefaults.selectMachineForProvider')}
                                subtitleLines={0}
                                icon={<Ionicons name="alert-circle-outline" size={29} color={theme.colors.textSecondary} />}
                                showChevron={false}
                            />
                        ) : fields.map((entry) => {
                            const isOpen = typeof expanded === 'object' && expanded?.agent === agent && expanded.field === entry.field;
                            const override = getAgentDefaultOverrideValue(streamlineAgentDefaults, agent, entry.field);
                            const latest = entry.field === 'modelMode' && followsLatest;
                            const detail = latest
                                ? t('newSession.streamline.latestModel')
                                : optionName(entry.options, entry.value) ?? '—';
                            return (
                                <React.Fragment key={entry.field}>
                                    <Item
                                        title={entry.title}
                                        detail={detail}
                                        icon={<Ionicons name={entry.icon} size={29} color={theme.colors.textLink} />}
                                        onPress={() => toggle({ agent, field: entry.field })}
                                    />
                                    {isOpen && (
                                        <>
                                            <Item
                                                title={t('common.reset')}
                                                subtitle={entry.field === 'modelMode' && STREAMLINE_CODE_DEFAULTS[agent]?.modelMode === ''
                                                    ? t('newSession.streamline.latestModelDescription')
                                                    : optionName(entry.options, entry.resetValue) ?? undefined}
                                                onPress={() => updateDefault(agent, entry.field, null)}
                                                rightElement={!override ? check : undefined}
                                                showChevron={false}
                                            />
                                            {(entry.field === 'modelMode'
                                                ? groupModelModesByProvider(entry.options)
                                                : [{ key: entry.field, title: null, models: entry.options }]
                                            ).map((group) => (
                                                <React.Fragment key={group.key}>
                                                    {group.title && <Item title={group.title} showChevron={false} />}
                                                    {group.models.map((option) => (
                                                        <Item
                                                            key={option.key}
                                                            title={option.name}
                                                            subtitle={option.description ?? undefined}
                                                            disabled={option.disabled || option.unavailable}
                                                            onPress={option.disabled || option.unavailable ? undefined : () => updateDefault(agent, entry.field, option.key)}
                                                            rightElement={override === option.key ? check : undefined}
                                                            showChevron={false}
                                                        />
                                                    ))}
                                                </React.Fragment>
                                            ))}
                                        </>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </ItemGroup>
                );
            })}
        </ItemList>
    );
}

export default withSettingsFrame('streamline', StreamlineSettingsScreen);
