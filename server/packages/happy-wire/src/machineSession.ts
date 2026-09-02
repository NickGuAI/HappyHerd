import { z } from 'zod';

/**
 * Version 1 means the target daemon validates launch settings, persists the
 * effective tuple, and returns that same tuple in the spawn receipt.
 */
export const HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION = 1;

/** Providers that the native Happy CLI daemon can launch. */
export const HAPPYHERD_MACHINE_SESSION_PROVIDERS = [
    'claude',
    'codex',
    'gemini',
    'grok',
    'dsh',
    'agy',
] as const;

export const HappyHerdMachineSessionProviderSchema = z.enum(
    HAPPYHERD_MACHINE_SESSION_PROVIDERS,
);

/**
 * Settings validated by the target daemon and applied to one spawned session.
 * A null value means that dimension remains owned by the provider's runtime
 * default because the target catalog does not advertise a concrete default.
 */
export const HappyHerdMachineSessionSettingsSchema = z.object({
    provider: HappyHerdMachineSessionProviderSchema,
    model: z.string().min(1).nullable(),
    effort: z.string().min(1).nullable(),
    permission: z.string().min(1).nullable(),
});

export type HappyHerdMachineSessionProvider = z.infer<typeof HappyHerdMachineSessionProviderSchema>;
export type HappyHerdMachineSessionSettings = z.infer<typeof HappyHerdMachineSessionSettingsSchema>;

/** Session-scoped handoff from the daemon to the provider process. */
export const HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV = 'HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON';
