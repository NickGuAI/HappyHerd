import * as z from 'zod';
import {
    HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG,
    normalizeHappyHerdClaudeModelSlug,
} from '@slopus/happy-wire';
import { HARNESS_ORDER } from '@/utils/harnessCatalog';

export const agentKeys = HARNESS_ORDER;
export type AgentKey = typeof agentKeys[number];
type StoredAgentKey = AgentKey | 'gemini';

export const AgentDefaultOverrideSchema = z.object({
    permissionMode: z.string().optional(),
    modelMode: z.string().optional(),
    effortLevel: z.string().optional(),
}).passthrough();

const activeAgentDefaultOverrideShape = Object.fromEntries(agentKeys.map((agent) => [
    agent,
    AgentDefaultOverrideSchema.optional(),
])) as Record<AgentKey, z.ZodOptional<typeof AgentDefaultOverrideSchema>>;

export const AgentDefaultOverridesSchema = z.object({
    ...activeAgentDefaultOverrideShape,
    // Retired Gemini preferences remain parseable so synced settings are not
    // destroyed merely because the provider left the launch registry.
    gemini: AgentDefaultOverrideSchema.optional(),
}).passthrough().default({});

export type AgentDefaultOverride = z.infer<typeof AgentDefaultOverrideSchema>;
export type AgentDefaultOverrides = z.infer<typeof AgentDefaultOverridesSchema>;
export type AgentDefaultField = keyof Pick<AgentDefaultOverride, 'permissionMode' | 'modelMode' | 'effortLevel'>;

export type AgentDefaultConfig = {
    permissionMode: string;
    modelMode: string;
    effortLevel: string | null;
};

const emptyAgentDefaults: AgentDefaultConfig = {
    permissionMode: '',
    modelMode: '',
    effortLevel: null,
};

const codeAgentDefaults: Record<StoredAgentKey, AgentDefaultConfig> = {
    // The Claude UI key for YOLO is `bypassPermissions`; the CLI also accepts
    // `yolo` and maps it to the Claude SDK's bypass mode.
    claude: {
        permissionMode: 'bypassPermissions',
        modelMode: HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG,
        effortLevel: 'max',
    },
    // Max is the configured default. The selected model's advertised
    // capabilities remain authoritative, so unsupported models fall back to
    // their highest available effort rather than receiving an invalid value.
    codex: { permissionMode: 'yolo', modelMode: 'gpt-5.6-sol', effortLevel: 'max' },
    // GrokBuild publishes its real defaults and selectable launch values
    // through the selected machine's capability catalog.
    // Empty defaults are deliberately neutral so an offline settings read can
    // never smuggle a Claude or Codex catalog into a Grok session.
    grok: emptyAgentDefaults,
    gemini: { permissionMode: 'default', modelMode: 'gemini-2.5-pro', effortLevel: null },
    agy: { permissionMode: 'default', modelMode: 'Gemini 3.1 Pro (High)', effortLevel: null },
    // Rig publishes all three dimensions through the exact selected machine.
    // Empty values keep an offline settings read honest and cannot masquerade
    // as Claude defaults.
    rig: emptyAgentDefaults,
};

export function normalizeAgentKey(flavor: string | null | undefined): StoredAgentKey | null {
    if (flavor === null || flavor === undefined || flavor === 'claude') return 'claude';
    if (flavor === 'codex' || flavor === 'grok' || flavor === 'gemini' || flavor === 'agy' || flavor === 'rig') {
        return flavor;
    }
    return null;
}

export function getCodeAgentDefaults(flavor: string | null | undefined): AgentDefaultConfig {
    const agent = normalizeAgentKey(flavor);
    return agent ? codeAgentDefaults[agent] : emptyAgentDefaults;
}

/**
 * Legacy permission keys for providers that do not support them, mapped to
 * what those old selections meant. Claude, GrokBuild, and Rig all own an exact
 * dontAsk token, so it must remain byte-faithful for those providers.
 */
const RETIRED_PERMISSION_MODES: Record<string, string> = {
    dontAsk: 'acceptEdits',
};

/**
 * Maps a stored permission mode onto one the CLI still accepts. Applies to
 * flavor-based agents only: a harness that publishes its own catalog owns its
 * codes, and none of them collide with a retired Claude key.
 */
export function retirePermissionMode<T extends string | null | undefined>(
    mode: T,
    flavor: string | null | undefined,
): T | string {
    if (flavor === null || flavor === undefined || flavor === 'claude' || flavor === 'grok' || flavor === 'rig') {
        return mode;
    }
    return mode ? RETIRED_PERMISSION_MODES[mode] ?? mode : mode;
}

export function getAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
): AgentDefaultOverride {
    const agent = normalizeAgentKey(flavor);
    if (!agent) return {};
    const override = overrides?.[agent] ?? {};
    const permissionMode = retirePermissionMode(override.permissionMode, agent);
    return permissionMode === override.permissionMode
        ? override
        : { ...override, permissionMode };
}

export function resolveAgentDefaultConfig(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
): AgentDefaultConfig {
    const codeDefaults = getCodeAgentDefaults(flavor);
    const userOverride = getAgentDefaultOverride(overrides, flavor);
    const modelMode = userOverride.modelMode ?? codeDefaults.modelMode;
    return {
        permissionMode: userOverride.permissionMode ?? codeDefaults.permissionMode,
        modelMode: normalizeAgentKey(flavor) === 'claude'
            ? normalizeHappyHerdClaudeModelSlug(modelMode)
            : modelMode,
        effortLevel: userOverride.effortLevel ?? codeDefaults.effortLevel,
    };
}

/**
 * Resolve the effective effort against the selected model's authoritative
 * capability list. Claude and Codex have a semantic "maximum available"
 * default rather than forcing an unsupported provider token: today that may
 * be `xhigh`, while a future model can advertise another top value without a
 * HappyHerd release.
 *
 * An explicit synchronized preference wins while it remains supported. If a
 * user moves to a model that does not support the saved value, use that
 * model's highest advertised effort without destroying the saved preference.
 */
export function resolveAgentDefaultEffortLevel(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    availableEfforts: ReadonlyArray<{ key: string }>,
): string | null {
    const configured = resolveAgentDefaultConfig(overrides, flavor).effortLevel;
    return resolveSupportedAgentEffortLevel(configured, flavor, availableEfforts);
}

/**
 * Resolve one concrete effort value against the selected model's advertised
 * capabilities. This is shared by launchers and outbound message metadata so
 * an unsupported synchronized preference can never re-enter the provider
 * path after a launcher has already fallen back to the model maximum.
 */
export function resolveSupportedAgentEffortLevel(
    configured: string | null | undefined,
    flavor: string | null | undefined,
    availableEfforts: ReadonlyArray<{ key: string }>,
): string | null {
    // The selected-model capability list is authoritative. Empty means the
    // model exposes no effort control, not that validation should be skipped.
    if (availableEfforts.length === 0) return null;

    const agent = normalizeAgentKey(flavor);
    // `max` is HappyHerd's semantic maximum, not a request to prefer a
    // provider token literally named "max" over a later/higher advertised
    // value such as "ultra".
    if (configured === 'max' && (agent === 'claude' || agent === 'codex')) {
        return availableEfforts.at(-1)?.key ?? null;
    }

    if (configured && availableEfforts.some((effort) => effort.key === configured)) {
        return configured;
    }

    if (agent === 'claude' || agent === 'codex') {
        return availableEfforts.at(-1)?.key ?? null;
    }

    return null;
}

export function hasAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    field: AgentDefaultField,
): boolean {
    return getAgentDefaultOverride(overrides, flavor)[field] !== undefined;
}

export function getAgentDefaultOverrideValue(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    field: AgentDefaultField,
): string | undefined {
    return getAgentDefaultOverride(overrides, flavor)[field];
}

export function setAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    field: AgentDefaultField,
    value: string | null | undefined,
): AgentDefaultOverrides {
    const key = normalizeAgentKey(flavor);
    if (!key) return { ...(overrides ?? {}) };
    const next: AgentDefaultOverrides = { ...(overrides ?? {}) };
    const current: AgentDefaultOverride = { ...(next[key] ?? {}) };

    if (value === null || value === undefined) {
        delete current[field];
    } else {
        current[field] = value;
    }

    if (current.permissionMode === undefined && current.modelMode === undefined && current.effortLevel === undefined) {
        delete next[key];
    } else {
        next[key] = current;
    }

    return next;
}
