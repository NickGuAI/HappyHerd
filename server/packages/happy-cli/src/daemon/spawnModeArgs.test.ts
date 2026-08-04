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
});
