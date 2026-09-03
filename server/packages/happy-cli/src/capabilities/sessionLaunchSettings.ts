import {
    HappyHerdMachineSessionSettingsSchema,
    type HappyHerdMachineSessionProvider,
    type HappyHerdMachineSessionSettings,
} from '@slopus/happy-wire';

import {
    AgentCapabilityCatalogSchema,
    type AgentCapabilityCatalog,
    type Metadata,
    type MachineMetadata,
} from '@/api/types';

export type MachineSessionSettingsRequest = {
    provider: HappyHerdMachineSessionProvider;
    model?: string;
    effort?: string;
    permission?: string;
};

type CapabilityOption = AgentCapabilityCatalog['models'][number];

/** Read only a provider-matching launch policy from the daemon-confirmed session receipt. */
export function persistedProviderPermissionMode(
    metadata: Pick<Metadata, 'spawnSettings' | 'permissionMode'>,
    provider: HappyHerdMachineSessionProvider,
): string | undefined {
    const settings = HappyHerdMachineSessionSettingsSchema.safeParse(metadata.spawnSettings);
    if (settings.success && settings.data.provider === provider) {
        return settings.data.permission ?? undefined;
    }
    // Grok predates launch receipts but persisted its process policy in this
    // synced metadata field. New launch-policy providers use spawnSettings.
    return provider === 'grok' ? metadata.permissionMode ?? undefined : undefined;
}

function defaultOption(options: CapabilityOption[]): CapabilityOption | undefined {
    return options.find((option) => option.isDefault === true)
        ?? options.find((option) => option.code === 'default');
}

function requireCatalogOption(
    options: CapabilityOption[],
    requested: string | undefined,
    dimension: string,
    provider: HappyHerdMachineSessionProvider,
): void {
    if (requested === undefined) return;
    if (options.length === 0) {
        throw new Error(`Provider ${provider} does not support an explicit ${dimension} on this machine`);
    }
    if (!options.some((option) => option.code === requested)) {
        throw new Error(`Provider ${provider} does not advertise ${dimension} "${requested}" on this machine`);
    }
}

/**
 * Resolve launch settings only from the selected machine's current catalog.
 * This function is deliberately used both by the requesting CLI and again by
 * the target daemon so a stale caller cannot select another provider or mode.
 */
export function resolveEffectiveSessionSettings(
    metadata: MachineMetadata,
    machineId: string,
    request: MachineSessionSettingsRequest,
): HappyHerdMachineSessionSettings {
    if (metadata.cliAvailability?.[request.provider] !== true) {
        throw new Error(`Provider ${request.provider} is unavailable on machine ${machineId}`);
    }

    const catalogValue = metadata.agentCapabilities?.[request.provider];
    const catalog = AgentCapabilityCatalogSchema.safeParse(catalogValue);
    if (!catalog.success) {
        if (
            request.provider !== 'dsh'
            && request.model === undefined
            && request.effort === undefined
            && request.permission === undefined
        ) {
            return {
                provider: request.provider,
                model: null,
                effort: null,
                permission: null,
            };
        }
        throw new Error(`Provider ${request.provider} has no valid advertised capability catalog on machine ${machineId}`);
    }

    return resolveCatalogSettings(catalog.data, request);
}

function resolveCatalogSettings(
    catalog: AgentCapabilityCatalog,
    request: MachineSessionSettingsRequest,
): HappyHerdMachineSessionSettings {
    requireCatalogOption(catalog.models, request.model, 'model', request.provider);
    requireCatalogOption(catalog.permissionModes, request.permission, 'permission mode', request.provider);

    const defaultModel = defaultOption(catalog.models);
    const selectedModel = request.model === undefined || request.model === 'default'
        ? defaultModel
        : catalog.models.find((model) => model.code === request.model);
    if (request.effort !== undefined && !selectedModel) {
        throw new Error(`Provider ${request.provider} has no model catalog for validating effort "${request.effort}"`);
    }
    const effortOptions = selectedModel?.effortLevels !== undefined
        ? selectedModel.effortLevels
        : catalog.effortLevels;
    requireCatalogOption(effortOptions, request.effort, 'effort level', request.provider);

    return HappyHerdMachineSessionSettingsSchema.parse({
        provider: request.provider,
        model: request.model === undefined || request.model === 'default'
            ? defaultModel?.code ?? null
            : request.model,
        effort: request.effort ?? defaultOption(effortOptions)?.code ?? null,
        permission: request.permission ?? defaultOption(catalog.permissionModes)?.code ?? null,
    });
}
