import type { Session } from './storageTypes';
import type { Settings } from './settings';
import {
    getAgentDefaultOverride,
    normalizeAgentKey,
    resolveAgentDefaultConfig,
    resolveSupportedAgentEffortLevel,
    retirePermissionMode,
} from './agentDefaults';
import type { PermissionModeKey } from '@/components/PermissionModeSelector';
import { permissionModeSupportedByCli } from '@/components/modelModeOptions';
import {
    getRigCurrentModel,
    getRigModels,
    getRigReasoningLevels,
    getRigReasoningSelection,
    getRigSelectedModelKey,
    isRigMetadataV1,
} from './rig';

export type MessageModeMeta = {
    permissionMode?: PermissionModeKey;
    model?: string | null;
    modelProviderId?: string;
    effort?: string | null;
};

/**
 * A saved mode is newer than the CLI receiving this message. Refuse instead
 * of substituting another policy behind the user's back.
 */
export class UnsupportedPermissionModeError extends Error {
    readonly mode: string;
    readonly cliVersion: string;

    constructor(mode: string, cliVersion: string) {
        super();
        this.name = 'UnsupportedPermissionModeError';
        this.mode = mode;
        this.cliVersion = cliVersion;
        Object.setPrototypeOf(this, UnsupportedPermissionModeError.prototype);
    }
}

type MessageModeCapabilityContext = {
    availableEfforts?: ReadonlyArray<{ key: string }>;
    availablePermissions?: ReadonlyArray<{ key: string }>;
};

export function resolveMessageModeMeta(
    session: Pick<Session, 'permissionMode' | 'modelMode' | 'metadata' | 'effortLevel'>,
    settings?: Pick<Settings, 'agentDefaultOverrides'>,
    capabilities?: MessageModeCapabilityContext,
): MessageModeMeta {
    if (isRigMetadataV1(session.metadata)) {
        const meta: MessageModeMeta = {};
        const permissionMode = session.permissionMode
            ?? session.metadata?.currentOperatingModeCode
            ?? session.metadata?.permissionMode
            ?? session.metadata?.session?.permissionMode;
        if (permissionMode) meta.permissionMode = permissionMode;

        const selectedKey = session.modelMode ?? getRigSelectedModelKey(session.metadata);
        const selectedModel = getRigModels(session.metadata).find((model) => model.key === selectedKey)
            ?? (selectedKey === getRigSelectedModelKey(session.metadata) ? getRigCurrentModel(session.metadata) : null);
        if (selectedModel) {
            meta.model = selectedModel.id;
            meta.modelProviderId = selectedModel.providerId;
        } else if (selectedKey?.includes(':')) {
            const separator = selectedKey.indexOf(':');
            meta.modelProviderId = selectedKey.slice(0, separator);
            meta.model = selectedKey.slice(separator + 1);
        }

        const levels = getRigReasoningLevels(session.metadata, selectedKey);
        const localEffort = session.effortLevel;
        const effort = localEffort && levels.includes(localEffort)
            ? localEffort
            : getRigReasoningSelection(session.metadata, selectedKey);
        if (effort) meta.effort = effort;
        return meta;
    }

    const agentOverrides = getAgentDefaultOverride(settings?.agentDefaultOverrides, session.metadata?.flavor);
    const meta: MessageModeMeta = {};
    const flavor = session.metadata?.flavor;
    const agentKey = normalizeAgentKey(flavor);

    const cliVersion = session.metadata?.version;
    const assertSupportedPermissionMode = (mode: string | null | undefined) => {
        if (mode && !permissionModeSupportedByCli(mode, cliVersion)) {
            throw new UnsupportedPermissionModeError(mode, cliVersion ?? 'unknown');
        }
        return mode;
    };

    // Codex and Agy turns need their effective selection on every message.
    // An abort temporarily resets the CLI to its launch policy, so omitting the
    // values after the app clears local overrides could make the visible
    // defaults execute as a different permission, model, or effort.
    if (flavor === 'codex' || flavor === 'agy') {
        const defaults = resolveAgentDefaultConfig(settings?.agentDefaultOverrides, flavor);
        const launchSettings = session.metadata?.spawnSettings?.provider === flavor
            ? session.metadata.spawnSettings
            : undefined;
        const permissionMode = assertSupportedPermissionMode(
            retirePermissionMode(
                session.permissionMode
                    ?? launchSettings?.permission
                    ?? session.metadata?.permissionMode
                    ?? defaults.permissionMode,
                flavor,
            ),
        );
        if (permissionMode) meta.permissionMode = permissionMode;

        const modelMode = session.modelMode
            ?? launchSettings?.model
            ?? session.metadata?.modelMode
            ?? defaults.modelMode;
        meta.model = modelMode === 'default' ? null : modelMode;

        const configuredEffort = session.effortLevel
            ?? launchSettings?.effort
            ?? session.metadata?.effortLevel
            ?? defaults.effortLevel;
        const effort = capabilities?.availableEfforts
            ? resolveSupportedAgentEffortLevel(
                configuredEffort,
                flavor,
                capabilities.availableEfforts,
            )
            : configuredEffort;
        if (effort !== undefined && effort !== null) meta.effort = effort;
        return meta;
    }

    // GrokBuild permission is fixed by its process launch flag. ACP operating
    // modes and requestPermission responses are separate runtime concepts.
    if (flavor !== 'grok') {
        const claudeLaunchSettings = agentKey === 'claude'
            && session.metadata?.spawnSettings?.provider === 'claude'
            ? session.metadata.spawnSettings
            : undefined;
        let permissionMode: string | null | undefined;
        if (session.permissionMode !== null && session.permissionMode !== undefined) {
            // New Session validates explicit selections against the exact
            // machine catalog. Keep provider-owned codes such as Claude
            // dontAsk exact; retire only keys unsupported by that provider.
            permissionMode = retirePermissionMode(session.permissionMode, agentKey);
        } else if (agentKey === 'claude') {
            permissionMode = claudeLaunchSettings
                ? claudeLaunchSettings.permission ?? undefined
                : session.metadata?.permissionMode
                    ?? resolveAgentDefaultConfig(settings?.agentDefaultOverrides, flavor).permissionMode;
        } else if (agentOverrides.permissionMode !== undefined) {
            permissionMode = agentOverrides.permissionMode;
        }
        if (
            agentKey === 'claude'
            && permissionMode === 'dontAsk'
            && !capabilities?.availablePermissions?.some((option) => option.key === 'dontAsk')
        ) {
            // dontAsk became available without a reliable CLI version gate.
            // Only the exact machine catalog can authorize that native token.
            // Substituting acceptEdits would silently widen a deny policy into
            // one that can edit files, so refuse the turn instead.
            throw new UnsupportedPermissionModeError(permissionMode, cliVersion ?? 'unknown');
        }
        assertSupportedPermissionMode(permissionMode);
        // An explicit Claude `default` is a real live-mode transition. Keep it
        // on the wire so a Human can leave bypass/yolo without restarting.
        if (permissionMode) {
            meta.permissionMode = permissionMode;
        }
    }

    const claudeLaunchSettings = agentKey === 'claude'
        && session.metadata?.spawnSettings?.provider === 'claude'
        ? session.metadata.spawnSettings
        : undefined;
    const modelMode = session.modelMode
        ?? (claudeLaunchSettings ? claudeLaunchSettings.model ?? undefined : agentOverrides.modelMode);
    // `default` is a product sentinel, not a provider model identifier.
    if (modelMode !== undefined && modelMode !== 'default') {
        meta.model = modelMode;
    }

    const configuredEffort = session.effortLevel
        ?? (claudeLaunchSettings ? claudeLaunchSettings.effort ?? undefined : agentOverrides.effortLevel);
    const effort = capabilities?.availableEfforts
        ? resolveSupportedAgentEffortLevel(
            configuredEffort,
            session.metadata?.flavor,
            capabilities.availableEfforts,
        )
        : configuredEffort;
    if (effort !== undefined && effort !== null) {
        meta.effort = effort;
    }

    return meta;
}
