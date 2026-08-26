import { describe, expect, it } from 'vitest';

import {
    HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
    HAPPYHERD_MACHINE_SESSION_PROVIDERS,
    HappyHerdMachineSessionSettingsSchema,
} from './machineSession';

describe('HappyHerdMachineSessionSettingsSchema', () => {
    it('accepts an exact provider launch receipt', () => {
        expect(HappyHerdMachineSessionSettingsSchema.parse({
            provider: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'high',
            permission: 'yolo',
        })).toEqual({
            provider: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'high',
            permission: 'yolo',
        });
        expect(HAPPYHERD_MACHINE_SESSION_PROVIDERS).toEqual([
            'claude', 'codex', 'gemini', 'grok', 'agy',
        ]);
        expect(HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION).toBe(1);
    });

    it('rejects unknown providers and empty setting values', () => {
        expect(HappyHerdMachineSessionSettingsSchema.safeParse({
            provider: 'rig',
            model: null,
            effort: null,
            permission: null,
        }).success).toBe(false);
        expect(HappyHerdMachineSessionSettingsSchema.safeParse({
            provider: 'codex',
            model: '',
            effort: null,
            permission: null,
        }).success).toBe(false);
    });
});
