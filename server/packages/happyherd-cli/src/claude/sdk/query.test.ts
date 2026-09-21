import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sdkQuery } = vi.hoisted(() => ({
    sdkQuery: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
            // The adapter contract is proven from the options passed to the
            // official SDK; no provider process is needed for this unit test.
        },
    })),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: sdkQuery,
}));

import { query } from './query';

describe('Claude SDK query adapter', () => {
    beforeEach(() => {
        sdkQuery.mockClear();
    });

    it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
        'passes optional Fable 5.1 and %s effort unchanged to the supported SDK',
        (effort) => {
            query({ prompt: 'Describe this code', options: { model: 'claude-fable-5-1', effort } });
            expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
                options: expect.objectContaining({ model: 'claude-fable-5-1', effort }),
            }));
        },
    );

    it('adds the SDK-required opt-in whenever the adapter starts in bypass mode', () => {
        query({
            prompt: 'run the task',
            options: {
                permissionMode: 'bypassPermissions',
            },
        });

        expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            }),
        }));
    });

    it('forwards an explicit opt-in for a later live switch into bypass mode', () => {
        query({
            prompt: 'run the task',
            options: {
                permissionMode: 'default',
                allowDangerouslySkipPermissions: true,
            },
        });

        expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                permissionMode: 'default',
                allowDangerouslySkipPermissions: true,
            }),
        }));
    });
});
