import { describe, expect, it } from 'vitest';

import type { Machine, Session } from '@/sync/storageTypes';
import { getGrokResumePermissionMode, getResumeAvailability } from './sessionResume';

function resumableSession(): Session {
    return {
        id: 'happy-session',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/workspace',
            flavor: 'codex',
            machineId: 'machine-1',
            codexThreadId: 'codex-thread',
        } as Session['metadata'],
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        presence: 1,
    };
}

function onlineMachine(): Machine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

describe('getResumeAvailability', () => {
    it('offers resume for an eligible disconnected provider session without a feature flag', () => {
        expect(getResumeAvailability(resumableSession(), onlineMachine(), false)).toMatchObject({
            canResume: true,
            canShowResume: true,
        });
    });

    it('keeps resume unavailable while the provider session is connected', () => {
        expect(getResumeAvailability(resumableSession(), onlineMachine(), true)).toMatchObject({
            canResume: false,
            canShowResume: false,
        });
    });

    it('offers GrokBuild resume only with its stored ACP id on the original online machine', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'grok-acp-session',
            acpCapabilities: {
                loadSession: true,
                prompt: { image: false },
            },
            spawnSettings: {
                provider: 'grok',
                model: 'grok-build',
                effort: 'high',
                permission: 'dontAsk',
            },
        } as Session['metadata'];
        const machine = onlineMachine();
        machine.metadata = {
            host: 'target',
            platform: 'linux',
            happyCliVersion: '1.0.0',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happyherd',
            happyLibDir: '/srv/happy',
            cliAvailability: {
                claude: false,
                codex: false,
                gemini: false,
                grok: true,
                agy: false,
                detectedAt: 1,
            },
            agentCapabilities: {
                grok: {
                    detectedAt: 1,
                    sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                    models: [{ code: 'grok-build', value: 'GrokBuild', isDefault: true }],
                    effortLevels: [{ code: 'high', value: 'High', isDefault: true }],
                    permissionModes: [
                        { code: 'default', value: 'Default', isDefault: true },
                        { code: 'dontAsk', value: 'Deny without asking' },
                    ],
                    acp: { loadSession: true, prompt: { image: true } },
                },
            },
        };

        expect(getResumeAvailability(session, machine, false)).toMatchObject({
            canResume: true,
            canShowResume: true,
        });
        expect(getGrokResumePermissionMode(session, machine)).toBe('dontAsk');
        expect(getResumeAvailability(session, null, false)).toMatchObject({
            canResume: false,
            messageKey: 'sessionInfo.resumeSessionSameMachineOnly',
        });
    });

    it('rejects Grok resume when the current exact machine no longer advertises its launch policy', () => {
        const session = resumableSession();
        session.permissionMode = 'bypassPermissions';
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'grok-acp-session',
            acpCapabilities: { loadSession: true, prompt: { image: false } },
        } as Session['metadata'];
        const machine = onlineMachine();
        machine.metadata = {
            host: 'target',
            platform: 'linux',
            happyCliVersion: '1.0.0',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happyherd',
            happyLibDir: '/srv/happy',
            cliAvailability: {
                claude: false,
                codex: false,
                gemini: false,
                grok: true,
                agy: false,
                detectedAt: 1,
            },
            agentCapabilities: {
                grok: {
                    detectedAt: 1,
                    sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                    models: [],
                    effortLevels: [],
                    permissionModes: [{ code: 'default', value: 'Default', isDefault: true }],
                    acp: { loadSession: true, prompt: { image: false } },
                },
            },
        };

        expect(getResumeAvailability(session, machine, false)).toEqual({
            canResume: false,
            canShowResume: false,
            messageKey: null,
        });
        expect(getGrokResumePermissionMode(session, machine)).toBeUndefined();
    });

    it('hides GrokBuild resume when ACP loadSession is false', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'grok-acp-session',
            acpCapabilities: {
                loadSession: false,
                prompt: { image: false },
            },
        } as Session['metadata'];

        expect(getResumeAvailability(session, onlineMachine(), false)).toEqual({
            canResume: false,
            canShowResume: false,
            messageKey: null,
        });
    });

    it('hides GrokBuild resume when ACP capability metadata is absent', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'grok-acp-session',
            acpCapabilities: undefined,
        } as Session['metadata'];

        expect(getResumeAvailability(session, onlineMachine(), false)).toEqual({
            canResume: false,
            canShowResume: false,
            messageKey: null,
        });
    });

    it('does not treat an ACP id as resumable for an unknown flavor', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'future-acp-provider',
            codexThreadId: undefined,
            acpSessionId: 'future-acp-session',
        } as Session['metadata'];

        expect(getResumeAvailability(session, onlineMachine(), false)).toEqual({
            canResume: false,
            canShowResume: true,
            messageKey: 'sessionInfo.resumeSessionMissingBackendId',
        });
    });
});
