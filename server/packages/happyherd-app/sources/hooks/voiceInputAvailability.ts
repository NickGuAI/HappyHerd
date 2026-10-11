export function resolveVoiceInputAvailability(configured: boolean, localReady = false): boolean {
    return configured || localReady;
}
