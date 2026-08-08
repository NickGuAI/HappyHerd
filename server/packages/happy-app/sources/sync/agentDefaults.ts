import * as z from 'zod';
import {
    HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG,
    normalizeHappyHerdClaudeModelSlug,
} from '@slopus/happy-wire';

export const agentKeys = ['claude', 'codex', 'gemini', 'openclaw', 'agy'] as const;
export type AgentKey = typeof agentKeys[number];

export const AgentDefaultOverrideSchema = z.object({
    permissionMode: z.string().optional(),
    modelMode: z.string().optional(),
    effortLevel: z.string().optional(),
}).passthrough();

export const AgentDefaultOverridesSchema = z.object({
    claude: AgentDefaultOverrideSchema.optional(),
    codex: AgentDefaultOverrideSchema.optional(),
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
        effortLevel: 'medium',
    },
    // Codex effort support is model- and provider-version-specific. A null
    // code default means "pick the highest effort advertised for the selected
    // model"; it must never be forwarded to the provider as a literal value.
    codex: { permissionMode: 'yolo', modelMode: 'gpt-5.5', effortLevel: null },
    gemini: { permissionMode: 'default', modelMode: 'gemini-2.5-pro', effortLevel: null },
    openclaw: { permissionMode: 'default', modelMode: 'default', effortLevel: null },
    agy: { permissionMode: 'default', modelMode: 'Gemini 3.1 Pro (High)', effortLevel: null },
};

export function normalizeAgentKey(flavor: string | null | undefined): AgentKey {
    if (flavor === 'codex' || flavor === 'gemini' || flavor === 'openclaw' || flavor === 'agy') {
        return flavor;
    }
    return 'claude';
}

export function getCodeAgentDefaults(flavor: string | null | undefined): AgentDefaultConfig {
    return codeAgentDefaults[normalizeAgentKey(flavor)];
}

export function getAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
): AgentDefaultOverride {
    return overrides?.[normalizeAgentKey(flavor)] ?? {};
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
 * capability list. Codex has a semantic "maximum available" default rather
 * than a hardcoded provider token: today that may be `xhigh`, while a future
 * model can advertise `ultra` (or another value) without a HappyHerd release.
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
    if (configured && (
        availableEfforts.length === 0
        || availableEfforts.some((effort) => effort.key === configured)
    )) {
        return configured;
    }

    if (normalizeAgentKey(flavor) === 'codex') {
        return availableEfforts.at(-1)?.key ?? null;
    }

    return configured;
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
