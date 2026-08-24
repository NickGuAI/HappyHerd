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

    it('omits ambient Claude default permission but forwards concrete Codex default', () => {
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

        expect(claudeArgs).toEqual(['claude']);
        expect(codexArgs).toEqual(['codex', '--permission-mode', 'default']);
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
});
