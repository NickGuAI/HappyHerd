import { describe, expect, it } from 'vitest';

import { appendDaemonSpawnModeArgs } from './spawnModeArgs';

describe('daemon spawn mode arguments', () => {
    it('passes a selected Claude model slug through unchanged', () => {
        const args = ['claude'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'claude',
            modelMode: 'claude-opus-4-6',
        }, 'claude');

        expect(args).toEqual(['claude', '--model', 'claude-opus-4-6']);
    });

    it('does not turn provider default into a model override', () => {
        const args = ['claude'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'claude',
            modelMode: 'default',
        }, 'claude');

        expect(args).toEqual(['claude']);
    });

    it('forwards an explicit default permission for Claude and Codex', () => {
        const claudeArgs = ['claude'];
        const codexArgs = ['codex'];

        appendDaemonSpawnModeArgs(claudeArgs, {
            directory: '/workspace',
            agent: 'claude',
            permissionMode: 'default',
        }, 'claude');
        appendDaemonSpawnModeArgs(codexArgs, {
            directory: '/workspace',
            agent: 'codex',
            permissionMode: 'default',
        }, 'codex');

        expect(claudeArgs).toEqual(['claude', '--permission-mode', 'default']);
        expect(codexArgs).toEqual(['codex', '--permission-mode', 'default']);
    });

    it('marks an explicitly unmanaged Codex child launch', () => {
        const args = ['codex'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'codex',
            providerAccount: null,
        }, 'codex');

        expect(args).toEqual(['codex', '--provider-account-mode', 'unmanaged']);
    });

    it('uses the target-daemon validated tuple instead of stale raw request fields', () => {
        const args = ['codex'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'codex',
            permissionMode: 'default',
            modelMode: 'stale-model',
            effortLevel: 'low',
            effectiveSettings: {
                provider: 'codex',
                permission: 'safe-yolo',
                model: 'target-model',
                effort: 'high',
            },
        }, 'codex');

        expect(args).toEqual([
            'codex',
            '--permission-mode', 'safe-yolo',
            '--model', 'target-model',
            '--effort', 'high',
        ]);
    });

    it('forwards explicit Auto permission and effort values byte-for-byte', () => {
        const args = ['codex'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'codex',
            permissionMode: 'auto',
            effortLevel: 'ultra',
        }, 'codex');

        expect(args).toEqual([
            'codex',
            '--permission-mode',
            'auto',
            '--effort',
            'ultra',
        ]);
    });

    it.each([
        'default',
        'acceptEdits',
        'auto',
        'dontAsk',
        'bypassPermissions',
        'plan',
    ])('forwards machine-advertised Grok launch mode %s to the Happy command', (permissionMode) => {
        const args = ['grok'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'grok',
            permissionMode,
            modelMode: 'runtime-model-id',
            effortLevel: 'runtime-effort-id',
        }, 'grok');

        expect(args).toEqual([
            'grok',
            '--permission-mode', permissionMode,
            '--model', 'runtime-model-id',
            '--effort', 'runtime-effort-id',
        ]);
    });

    it('forwards Antigravity model and permission but not a separate effort', () => {
        const args = ['agy'];

        appendDaemonSpawnModeArgs(args, {
            directory: '/workspace',
            agent: 'agy',
            permissionMode: 'bypassPermissions',
            modelMode: 'Gemini 3.1 Pro (High)',
            effortLevel: 'high',
        }, 'agy');

        expect(args).toEqual([
            'agy',
            '--permission-mode', 'bypassPermissions',
            '--model', 'Gemini 3.1 Pro (High)',
        ]);
    });
});
