export function userSafeguardMessageMeta(
    flavor: string | null | undefined,
    enabled: boolean,
): { userSafeguardEnabled?: boolean } {
    // Legacy Claude sessions omit flavor; the rest of the app treats that as
    // Claude, so the safeguard metadata must follow the same normalization.
    if (flavor != null && flavor !== 'claude' && flavor !== 'codex') return {};
    return { userSafeguardEnabled: enabled };
}
