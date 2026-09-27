import { HAPPYHERD_CLAUDE_OPUS_5_5_MODEL_SLUG } from '@happyherd/wire';
import {
    getAgentDefaultOverride,
    normalizeAgentKey,
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
    resolveSupportedAgentEffortLevel,
    type AgentDefaultConfig,
    type AgentDefaultOverrides,
} from './agentDefaults';
import type { MachineMetadata } from './storageTypes';
import { getRigMachineSessionCreation } from './rigSessionCreation';
import {
    getAdvertisedDefaultOptionKey,
    getMachineAdvertisedEffortLevels,
    getMachineAdvertisedModels,
    getMachineAdvertisedPermissionModes,
    hasMachineCapabilityCatalog,
    type ModeOption,
} from '@/components/modelModeOptions';
import { findPreferredAvailableOptionIndex } from '@/utils/newSessionModeSelection';

export type StreamlineAgent = NonNullable<ReturnType<typeof normalizeAgentKey>>;

export const STREAMLINE_CODE_DEFAULTS: Readonly<Partial<Record<StreamlineAgent, AgentDefaultConfig>>> = {
    claude: { modelMode: HAPPYHERD_CLAUDE_OPUS_5_5_MODEL_SLUG, effortLevel: 'xhigh', permissionMode: 'acceptEdits' },
    codex: { modelMode: 'gpt-6-astra', effortLevel: 'xhigh', permissionMode: 'default' },
    gemini: { modelMode: 'gemini-3.1-pro-preview', effortLevel: 'high', permissionMode: 'autoEdit' },
    // An empty model preference follows this machine's catalog default.
    grok: { modelMode: '', effortLevel: 'high', permissionMode: 'acceptEdits' },
    dsh: { modelMode: 'deepseek-v4-flash', effortLevel: 'medium', permissionMode: 'default' },
};

/** Unknown synced agent keys remain stored, but read as Claude on this version. */
export function normalizeStreamlineAgent(agent: string | null | undefined): StreamlineAgent {
    return normalizeAgentKey(agent) ?? 'claude';
}

export type StreamlineSelection = {
    permissionMode: string | null;
    modelMode: string | null;
    effortLevel: string | null;
};

export type ResolveStreamlineSelectionInput = {
    agent: string | null | undefined;
    /** Only the exact selected machine's metadata; never an account-wide catalog. */
    machineMetadata: MachineMetadata | null | undefined;
    streamlineAgentDefaults?: AgentDefaultOverrides | null;
    /** Existing Agent Defaults are the base for agy and rig only. */
    agentDefaultOverrides?: AgentDefaultOverrides | null;
};

/**
 * Resolves preferences without mutating settings or the session draft. No
 * catalog means no explicit launch values, including when a machine is offline.
 * Call again when the selected machine, its catalog, or synced settings change.
 */
export function resolveStreamlineSelection({
    agent: storedAgent,
    machineMetadata,
    streamlineAgentDefaults,
    agentDefaultOverrides,
}: ResolveStreamlineSelectionInput): StreamlineSelection {
    const agent = normalizeStreamlineAgent(storedAgent);
    const rig = agent === 'rig' ? getRigMachineSessionCreation(machineMetadata) : null;
    if (agent === 'rig' ? !rig : !hasMachineCapabilityCatalog(machineMetadata, agent)) {
        return { permissionMode: null, modelMode: null, effortLevel: null };
    }

    const codeDefaults = STREAMLINE_CODE_DEFAULTS[agent];
    const baseDefaults = codeDefaults ?? resolveAgentDefaultConfig(agentDefaultOverrides, agent);
    const overrides = getAgentDefaultOverride(streamlineAgentDefaults, agent);
    const configured = resolveAgentDefaultConfig({
        [agent]: {
            ...baseDefaults,
            // Override fields use strings; null effort means no preference.
            effortLevel: baseDefaults.effortLevel ?? undefined,
            ...overrides,
        },
    }, agent);
    // No recovery-only options are requested: these lists contain advertised values only.
    const permissions: readonly ModeOption[] = rig?.permissionModes
        ?? getMachineAdvertisedPermissionModes(machineMetadata, agent, (key) => key);
    const models: readonly ModeOption[] = rig?.models
        ?? getMachineAdvertisedModels(machineMetadata, agent, (key) => key);
    const permissionMode = permissions[findPreferredAvailableOptionIndex(permissions, [
        configured.permissionMode,
        codeDefaults?.permissionMode,
        rig?.defaultPermissionMode ?? getAdvertisedDefaultOptionKey(permissions),
    ])]?.key ?? null;
    const modelMode = models[findPreferredAvailableOptionIndex(models, [
        configured.modelMode,
        rig?.defaultModelKey ?? getAdvertisedDefaultOptionKey(models),
    ])]?.key ?? null;
    const efforts = rig
        ? rig.effortsForModel(modelMode).map((key) => ({ key }))
        : getMachineAdvertisedEffortLevels(machineMetadata, agent, modelMode ?? 'default');
    const configuredEffort = !codeDefaults && overrides.effortLevel === undefined
        ? resolveAgentDefaultEffortLevel(agentDefaultOverrides, agent, efforts)
        : resolveSupportedAgentEffortLevel(configured.effortLevel, agent, efforts);
    const effortLevel = efforts[findPreferredAvailableOptionIndex(efforts, [
        configuredEffort,
        rig?.defaultEffortForModel(modelMode) ?? getAdvertisedDefaultOptionKey(efforts),
    ])]?.key ?? null;

    return { permissionMode, modelMode, effortLevel };
}
