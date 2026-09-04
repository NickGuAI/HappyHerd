import { describe, expect, it } from 'vitest';

import type { Machine, Session } from '@/sync/storageTypes';
import {
    getClaudeResumeModes,
    getCodexResumeModes,
    getDshResumeModes,
    getCodexResumePermissionMode,
    getGrokResumePermissionMode,
    getResumeAvailability,
} from './sessionResume';

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
        metadata: {
            host: 'target',
            platform: 'linux',
            happyCliVersion: '1.0.0',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happyherd',
            happyLibDir: '/srv/happy',
            cliAvailability: {
                claude: true,
                codex: true,
                gemini: false,
                grok: false,
                agy: false,
                detectedAt: 1,
            },
            agentCapabilities: {
                claude: {
                    detectedAt: 1,
                    sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                    models: [
                        { code: 'default', value: 'Default', isDefault: true },
                        { code: 'claude-opus-test', value: 'Claude Opus Test' },
                    ],
                    effortLevels: [
                        { code: 'max', value: 'Max', isDefault: true },
                        { code: 'high', value: 'High' },
                    ],
                    permissionModes: [
                        { code: 'default', value: 'Default', isDefault: true },
                        { code: 'plan', value: 'Plan' },
                        { code: 'bypassPermissions', value: 'Bypass permissions' },
                    ],
                },
                codex: {
                    detectedAt: 1,
                    sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                    models: [{
                        code: 'gpt-test',
                        value: 'GPT Test',
                        isDefault: true,
                        effortLevels: [
                            { code: 'medium', value: 'Medium', isDefault: true },
                            { code: 'high', value: 'High' },
                        ],
                    }],
                    effortLevels: [{ code: 'fallback', value: 'Fallback', isDefault: true }],
                    permissionModes: [
                        { code: 'safe-yolo', value: 'Workspace', isDefault: true },
                        { code: 'read-only', value: 'Read only' },
                        { code: 'yolo', value: 'Full access' },
                    ],
                },
            },
        },
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

    it('restores and displays the latest Codex selection ahead of its launch receipt', () => {
        const session = resumableSession();
        session.permissionMode = 'read-only';
        session.modelMode = 'gpt-test';
        session.effortLevel = 'medium';
        session.metadata = {
            ...session.metadata,
            permissionMode: 'read-only',
            spawnSettings: {
                provider: 'codex',
                model: 'gpt-test',
                effort: 'high',
                permission: 'yolo',
            },
        } as Session['metadata'];
        const machine = onlineMachine();

        expect(getCodexResumePermissionMode(session, machine)).toBe('read-only');
        expect(getCodexResumeModes(session, machine)).toEqual({
            permissionMode: 'read-only',
            modelMode: 'gpt-test',
            effortLevel: 'medium',
        });
        expect(getResumeAvailability(session, machine, false)).toMatchObject({
            canResume: true,
            canShowResume: true,
        });
    });

    it('uses a persisted Codex selection for a receipt-less legacy session', () => {
        const session = resumableSession();
        session.permissionMode = 'read-only';

        expect(getCodexResumePermissionMode(session, onlineMachine())).toBe('read-only');
        expect(getCodexResumeModes(session, onlineMachine())).toEqual({
            permissionMode: 'read-only',
            modelMode: 'gpt-test',
            effortLevel: 'medium',
        });
    });

    it('falls back to the validated Codex launch receipt after an abort clears the override', () => {
        const session = resumableSession();
        session.permissionMode = null;
        session.modelMode = null;
        session.effortLevel = null;
        session.metadata = {
            ...session.metadata,
            permissionMode: 'read-only',
            modelMode: 'gpt-test',
            effortLevel: 'medium',
            spawnSettings: {
                provider: 'codex',
                model: 'gpt-test',
                effort: 'high',
                permission: 'yolo',
            },
        } as Session['metadata'];

        expect(getCodexResumeModes(session, onlineMachine())).toEqual({
            permissionMode: 'yolo',
            modelMode: 'gpt-test',
            effortLevel: 'high',
        });
    });

    it('restores the latest complete Claude selection ahead of its launch receipt', () => {
        const session = resumableSession();
        session.permissionMode = 'bypassPermissions';
        session.modelMode = 'claude-opus-test';
        session.effortLevel = 'high';
        session.metadata = {
            ...session.metadata,
            flavor: 'claude',
            codexThreadId: undefined,
            claudeSessionId: '11111111-1111-4111-8111-111111111111',
            spawnSettings: {
                provider: 'claude',
                model: 'default',
                effort: 'max',
                permission: 'default',
            },
        } as Session['metadata'];

        expect(getClaudeResumeModes(session, onlineMachine())).toEqual({
            permissionMode: 'bypassPermissions',
            modelMode: 'claude-opus-test',
            effortLevel: 'high',
        });
        expect(getResumeAvailability(session, onlineMachine(), false)).toMatchObject({
            canResume: true,
            canShowResume: true,
        });
    });

    it('rejects a Codex receipt when any persisted dimension is no longer advertised', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            spawnSettings: {
                provider: 'codex',
                model: 'gpt-test',
                effort: 'retired-effort',
                permission: 'safe-yolo',
            },
        } as Session['metadata'];

        expect(getCodexResumeModes(session, onlineMachine())).toBeUndefined();
        expect(getResumeAvailability(session, onlineMachine(), false)).toMatchObject({
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

    it('offers DSH resume from a retained ACP id when the exact machine currently advertises session/resume', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'dsh',
            codexThreadId: undefined,
            acpSessionId: 'dsh-provider-session',
            acpCapabilities: { loadSession: false, prompt: { image: false } },
            spawnSettings: {
                provider: 'dsh',
                model: 'deepseek-v4-flash',
                effort: 'high',
                permission: null,
            },
        } as Session['metadata'];
        const machine = onlineMachine();
        machine.metadata!.cliAvailability = {
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            dsh: true,
            agy: false,
            detectedAt: 1,
        };
        machine.metadata!.agentCapabilities = {
            dsh: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [{ code: 'deepseek-v4-flash', value: 'DeepSeek V4 Flash', isDefault: true }],
                effortLevels: [{ code: 'high', value: 'High', isDefault: true }],
                permissionModes: [{ code: 'workspace-write', value: 'Workspace write', isDefault: true }],
                acp: { loadSession: false, resumeSession: true, prompt: { image: false } },
            },
        };

        expect(getResumeAvailability(session, machine, false)).toEqual({
            canResume: true,
            canShowResume: true,
            messageKey: 'sessionInfo.resumeSessionSubtitle',
        });
        expect(getDshResumeModes(session, machine)).toEqual({
            permissionMode: 'workspace-write',
            modelMode: 'deepseek-v4-flash',
            effortLevel: 'high',
        });
    });

    it('hides DSH resume when the exact machine does not advertise session/resume', () => {
        const session = resumableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'dsh',
            codexThreadId: undefined,
            acpSessionId: 'dsh-provider-session',
            acpCapabilities: { loadSession: false, resumeSession: true, prompt: { image: false } },
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
