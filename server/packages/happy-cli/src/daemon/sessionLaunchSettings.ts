import {
    HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV,
    HappyHerdMachineSessionSettingsSchema,
    type HappyHerdMachineSessionSettings,
} from '@slopus/happy-wire';

export function machineSessionSettingsEnvironment(
    settings: HappyHerdMachineSessionSettings | undefined,
): Record<string, string> {
    if (!settings) return {};
    return {
        [HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV]: JSON.stringify(
            HappyHerdMachineSessionSettingsSchema.parse(settings),
        ),
    };
}

export function machineSessionSettingsMetadataFromEnvironment(
    env: NodeJS.ProcessEnv = process.env,
): { spawnSettings?: HappyHerdMachineSessionSettings } {
    const raw = env[HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV];
    if (raw === undefined) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV} must contain valid JSON`);
    }
    return {
        spawnSettings: HappyHerdMachineSessionSettingsSchema.parse(parsed),
    };
}

export function persistedMachineSessionSettingsMatch(
    metadata: unknown,
    expected: HappyHerdMachineSessionSettings | undefined,
): boolean {
    if (!expected) return true;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    const parsed = HappyHerdMachineSessionSettingsSchema.safeParse(
        (metadata as Record<string, unknown>).spawnSettings,
    );
    return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(expected);
}
