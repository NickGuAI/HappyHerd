import { describe, expect, it } from 'vitest';

import { HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV } from '@slopus/happy-wire';
import {
    machineSessionSettingsEnvironment,
    machineSessionSettingsMetadataFromEnvironment,
    persistedMachineSessionSettingsMatch,
} from './sessionLaunchSettings';

const settings = {
    provider: 'codex' as const,
    model: 'gpt-5.6-sol',
    effort: 'high',
    permission: 'yolo',
};

describe('machine session launch settings handoff', () => {
    it('serializes settings into one session-scoped value and restores metadata', () => {
        const env = machineSessionSettingsEnvironment(settings);
        expect(machineSessionSettingsMetadataFromEnvironment(env)).toEqual({ spawnSettings: settings });
        expect(persistedMachineSessionSettingsMatch({ spawnSettings: settings }, settings)).toBe(true);
    });

    it('rejects malformed handoffs and mismatched persisted metadata', () => {
        expect(() => machineSessionSettingsMetadataFromEnvironment({
            [HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV]: '{',
        })).toThrow('must contain valid JSON');
        expect(persistedMachineSessionSettingsMatch({
            spawnSettings: { ...settings, effort: 'low' },
        }, settings)).toBe(false);
    });
});
