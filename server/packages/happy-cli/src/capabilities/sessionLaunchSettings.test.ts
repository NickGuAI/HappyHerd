import { describe, expect, it } from 'vitest';

import type { MachineMetadata } from '@/api/types';
import { persistedProviderPermissionMode, resolveEffectiveSessionSettings } from './sessionLaunchSettings';

function metadata(): MachineMetadata {
    return {
        host: 'target',
        platform: 'linux',
        happyCliVersion: '1.2.3',
        homeDir: '/home/user',
        happyHomeDir: '/home/user/.happyherd',
        happyLibDir: '/opt/happy',
        cliAvailability: {
            claude: false,
            codex: true,
            gemini: false,
            grok: false,
            dsh: false,
            agy: false,
            detectedAt: 1,
        },
        agentCapabilities: {
            codex: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [
                    { code: 'default', value: 'Provider default' },
                    { code: 'gpt-5.6-sol', value: 'GPT 5.6 Sol', isDefault: true },
                    { code: 'gpt-a', value: 'GPT A', effortLevels: [
                        { code: 'medium', value: 'Medium', isDefault: true },
                        { code: 'high', value: 'High' },
                    ] },
                ],
                effortLevels: [
                    { code: 'medium', value: 'Medium' },
                    { code: 'max', value: 'Max', isDefault: true },
                ],
                permissionModes: [
                    { code: 'default', value: 'Ask first' },
                    { code: 'yolo', value: 'Full access', isDefault: true },
                ],
            },
        },
    };
}

describe('resolveEffectiveSessionSettings', () => {
    it('reads permission policy only from a provider-matching persisted launch receipt', () => {
        expect(persistedProviderPermissionMode({
            spawnSettings: {
                provider: 'grok',
                model: 'grok-build',
                effort: 'high',
                permission: 'dontAsk',
            },
        } as never, 'grok')).toBe('dontAsk');
        expect(persistedProviderPermissionMode({
            spawnSettings: {
                provider: 'codex',
                model: null,
                effort: null,
                permission: 'yolo',
            },
        } as never, 'grok')).toBeUndefined();
        expect(persistedProviderPermissionMode({
            permissionMode: 'bypassPermissions',
        } as never, 'grok')).toBe('bypassPermissions');
    });

    it('resolves target-advertised defaults when overrides are omitted', () => {
        expect(resolveEffectiveSessionSettings(metadata(), 'machine-1', { provider: 'codex' })).toEqual({
            provider: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'max',
            permission: 'yolo',
        });
    });

    it('validates dsh against its exact live machine catalog', () => {
        const target = metadata();
        target.cliAvailability = {
            ...target.cliAvailability!,
            codex: false,
            dsh: true,
        };
        target.agentCapabilities = {
            dsh: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'unsupported' },
                models: [
                    { code: 'deepseek-v4-flash', value: 'deepseek-v4-flash', isDefault: true },
                    { code: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
                ],
                effortLevels: [
                    { code: 'off', value: 'off' },
                    { code: 'low', value: 'low' },
                    { code: 'high', value: 'high', isDefault: true },
                    { code: 'max', value: 'max' },
                ],
                permissionModes: [],
                acp: { loadSession: false, prompt: { image: false } },
            },
        };

        expect(resolveEffectiveSessionSettings(target, 'machine-1', { provider: 'dsh' })).toEqual({
            provider: 'dsh',
            model: 'deepseek-v4-flash',
            effort: 'high',
            permission: null,
        });
        expect(resolveEffectiveSessionSettings(target, 'machine-1', {
            provider: 'dsh',
            model: 'deepseek-v4-pro',
            effort: 'max',
        })).toEqual({
            provider: 'dsh',
            model: 'deepseek-v4-pro',
            effort: 'max',
            permission: null,
        });
        expect(() => resolveEffectiveSessionSettings(target, 'machine-1', {
            provider: 'dsh',
            model: 'deepseek-v4-flash-vision-exp',
            effort: 'max',
        })).toThrow('Provider dsh does not advertise model "deepseek-v4-flash-vision-exp" on this machine');
    });

    it('resolves the concrete Antigravity model default without inventing effort', () => {
        const target = metadata();
        target.cliAvailability = {
            ...target.cliAvailability!,
            codex: false,
            agy: true,
        };
        target.agentCapabilities = {
            agy: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [
                    { code: 'Gemini 3.1 Pro (High)', value: 'Gemini 3.1 Pro (High)', isDefault: true },
                    { code: 'Claude Opus 4.6 (Thinking)', value: 'Claude Opus 4.6 (Thinking)' },
                ],
                effortLevels: [],
                permissionModes: [{ code: 'default', value: 'Default', isDefault: true }],
            },
        };

        expect(resolveEffectiveSessionSettings(target, 'machine-1', { provider: 'agy' })).toEqual({
            provider: 'agy',
            model: 'Gemini 3.1 Pro (High)',
            effort: null,
            permission: 'default',
        });
    });

    it('keeps Claude effort ambient when the valid catalog does not advertise max or another default', () => {
        const target = metadata();
        target.cliAvailability = {
            ...target.cliAvailability!,
            codex: false,
            claude: true,
        };
        target.agentCapabilities = {
            claude: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'cli-help', permissionModes: 'test' },
                models: [{ code: 'default', value: 'Provider default', isDefault: true }],
                effortLevels: [
                    { code: 'low', value: 'Low' },
                    { code: 'high', value: 'High' },
                ],
                permissionModes: [{ code: 'default', value: 'Default', isDefault: true }],
            },
        };

        expect(resolveEffectiveSessionSettings(target, 'machine-1', { provider: 'claude' })).toEqual({
            provider: 'claude',
            model: 'default',
            effort: null,
            permission: 'default',
        });
    });

    it('returns an all-ambient receipt when a catalogless provider launch omits every selection', () => {
        const target = metadata();
        target.cliAvailability = {
            ...target.cliAvailability!,
            codex: false,
            claude: true,
        };
        target.agentCapabilities = undefined;

        expect(resolveEffectiveSessionSettings(target, 'machine-1', { provider: 'claude' })).toEqual({
            provider: 'claude',
            model: null,
            effort: null,
            permission: null,
        });
    });

    it('returns exact explicit values and never falls back to another provider', () => {
        expect(resolveEffectiveSessionSettings(metadata(), 'machine-1', {
            provider: 'codex',
            model: 'gpt-a',
            effort: 'high',
            permission: 'yolo',
        })).toEqual({
            provider: 'codex',
            model: 'gpt-a',
            effort: 'high',
            permission: 'yolo',
        });
        expect(() => resolveEffectiveSessionSettings(metadata(), 'machine-1', {
            provider: 'claude',
        })).toThrow('Provider claude is unavailable');
    });
});
