import * as z from 'zod';
import {
    HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG,
    normalizeHappyHerdClaudeModelSlug,
} from '@slopus/happy-wire';

export const agentKeys = ['claude', 'codex', 'grok', 'gemini', 'openclaw', 'agy'] as const;
export type AgentKey = typeof agentKeys[number];

export const AgentDefaultOverrideSchema = z.object({
    permissionMode: z.string().optional(),
    modelMode: z.string().optional(),
    effortLevel: z.string().optional(),
}).passthrough();

export const AgentDefaultOverridesSchema = z.object({
    claude: AgentDefaultOverrideSchema.optional(),
    codex: AgentDefaultOverrideSchema.optional(),
    grok: AgentDefaultOverrideSchema.optional(),
    gemini: AgentDefaultOverrideSchema.optional(),
    openclaw: AgentDefaultOverrideSchema.optional(),
    agy: AgentDefaultOverrideSchema.optional(),
}).passthrough().default({});

export type AgentDefaultOverride = z.infer<typeof AgentDefaultOverrideSchema>;
export type AgentDefaultOverrides = z.infer<typeof AgentDefaultOverridesSchema>;
export type AgentDefaultField = keyof Pick<AgentDefaultOverride, 'permissionMode' | 'modelMode' | 'effortLevel'>;

export type AgentDefaultConfig = {
    permissionMode: string;
    modelMode: string;
    effortLevel: string | null;
};

const codeAgentDefaults: Record<AgentKey, AgentDefaultConfig> = {
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
    // GrokBuild publishes its real defaults and selectable values through ACP.
    // These sentinels are deliberately neutral so an offline settings read can
    // never smuggle a Claude or Codex catalog into a Grok session.
    grok: { permissionMode: 'default', modelMode: 'default', effortLevel: null },
    gemini: { permissionMode: 'default', modelMode: 'gemini-2.5-pro', effortLevel: null },
    openclaw: { permissionMode: 'default', modelMode: 'default', effortLevel: null },
    agy: { permissionMode: 'default', modelMode: 'Gemini 3.1 Pro (High)', effortLevel: null },
};

export function normalizeAgentKey(flavor: string | null | undefined): AgentKey {
    if (flavor === 'codex' || flavor === 'grok' || flavor === 'gemini' || flavor === 'openclaw' || flavor === 'agy') {
        return flavor;
    }
    return 'claude';
}

export function getCodeAgentDefaults(flavor: string | null | undefined): AgentDefaultConfig {
    return codeAgentDefaults[normalizeAgentKey(flavor)];
}

/**
 * Permission keys that were offered once and are no longer accepted, mapped to
 * what they meant. `dontAsk` never passed the CLI's message schema, so it was
 * already dropped on the wire; it is retired here so a saved copy cannot make
 * the composer show one mode while sending another.
 */
const RETIRED_PERMISSION_MODES: Record<string, string> = {
    dontAsk: 'acceptEdits',
};

/**
 * Maps a stored permission mode onto one the CLI still accepts. Applies to
 * flavor-based agents only: a harness that publishes its own catalog owns its
 * codes, and none of them collide with a retired Claude key.
 */
export function retirePermissionMode<T extends string | null | undefined>(mode: T): T | string {
    return mode ? RETIRED_PERMISSION_MODES[mode] ?? mode : mode;
}

export function getAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
): AgentDefaultOverride {
    const override = overrides?.[normalizeAgentKey(flavor)] ?? {};
    const permissionMode = retirePermissionMode(override.permissionMode);
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
