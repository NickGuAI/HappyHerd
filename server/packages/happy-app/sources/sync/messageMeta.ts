import type { Session } from './storageTypes';
import type { Settings } from './settings';
import {
    getAgentDefaultOverride,
    resolveSupportedAgentEffortLevel,
    retirePermissionMode,
} from './agentDefaults';
import type { PermissionModeKey } from '@/components/PermissionModeSelector';
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

type MessageModeCapabilityContext = {
    availableEfforts?: ReadonlyArray<{ key: string }>;
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

    let permissionMode: string | null | undefined;
    if (session.permissionMode !== null && session.permissionMode !== undefined) {
        // A session picked before a mode was retired still carries the old key,
        // and the CLI rejects the whole message envelope on an unknown one.
        permissionMode = retirePermissionMode(session.permissionMode);
    } else if (agentOverrides.permissionMode !== undefined) {
        permissionMode = agentOverrides.permissionMode;
    }
    // Claude's `default` is ambient: omitting it lets the SDK apply the
    // process/user configuration. Codex's `default` is a concrete ask-first
    // execution policy and must stay on the wire.
    if (permissionMode && !(flavor === 'claude' && permissionMode === 'default')) {
        meta.permissionMode = permissionMode;
    }

    const modelMode = session.modelMode ?? agentOverrides.modelMode;
    // `default` is a product sentinel, not a provider model identifier.
    if (modelMode !== undefined && modelMode !== 'default') {
        meta.model = modelMode;
    }

    const configuredEffort = session.effortLevel ?? agentOverrides.effortLevel;
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
