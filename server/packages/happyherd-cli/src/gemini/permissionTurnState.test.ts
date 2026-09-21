import { describe, expect, it, vi } from 'vitest';

import { GeminiPermissionHandler } from './utils/permissionHandler';
import {
    abortGeminiPermissionRequests,
    GeminiPermissionTurnState,
} from './permissionTurnState';

describe('Gemini permission turn state', () => {
    it.each([
        ['yolo', 'default'],
        ['default', 'yolo'],
    ] as const)('does not apply a queued %s -> %s transition to the active turn', async (active, queued) => {
        const state = new GeminiPermissionTurnState();
        const sink = { setPermissionMode: vi.fn() };

        const activeMode = state.selectForQueue(active);
        await state.applyAfterPreviousTurn(activeMode, sink);
        const queuedMode = state.selectForQueue(queued);

        expect(sink.setPermissionMode).toHaveBeenCalledTimes(1);
        expect(sink.setPermissionMode).toHaveBeenLastCalledWith(active);

        await state.applyAfterPreviousTurn(queuedMode, sink);
        expect(sink.setPermissionMode).toHaveBeenLastCalledWith(queued);
    });

    it('keeps the active mode during asynchronous teardown of the prior backend', async () => {
        const state = new GeminiPermissionTurnState();
        const sink = { setPermissionMode: vi.fn() };
        await state.applyAfterPreviousTurn(state.selectForQueue('yolo'), sink);

        let finishDispose!: () => void;
        const disposing = new Promise<void>((resolve) => { finishDispose = resolve; });
        const transition = state.applyAfterPreviousTurn(
            state.selectForQueue('default'),
            sink,
            () => disposing,
        );

        await Promise.resolve();
        expect(sink.setPermissionMode).toHaveBeenLastCalledWith('yolo');
        finishDispose();
        await transition;
        expect(sink.setPermissionMode).toHaveBeenLastCalledWith('default');
    });

    it('refuses an unknown explicit mode instead of inheriting the prior mode', () => {
        const state = new GeminiPermissionTurnState();
        state.selectForQueue('yolo');

        expect(() => state.selectForQueue('future-mode')).toThrow(
            'Unsupported Gemini permission mode: future-mode',
        );
    });
});

describe('Gemini permission abort', () => {
    it('settles and clears pending approval before provider cancellation', async () => {
        let agentState: Record<string, any> = {};
        const session = {
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn((updater: (current: Record<string, any>) => Record<string, any>) => {
                agentState = updater(agentState);
            }),
        } as any;
        const handler = new GeminiPermissionHandler(session);
        const pending = handler.handleToolCall('tool-1', 'bash', { command: 'pwd' });
        const order: string[] = [];

        expect(agentState.requests).toHaveProperty('tool-1');
        await abortGeminiPermissionRequests(handler, async () => {
            order.push('provider-cancel');
        });

        await expect(pending).resolves.toEqual({ decision: 'abort' });
        expect(agentState.requests).toEqual({});
        expect(agentState.completedRequests['tool-1']).toMatchObject({ status: 'canceled' });
        expect(order).toEqual(['provider-cancel']);
    });

    it('invokes permission abort before provider cancellation', async () => {
        const order: string[] = [];
        await abortGeminiPermissionRequests(
            { abortAll: () => order.push('permission-abort') },
            async () => { order.push('provider-cancel'); },
        );

        expect(order).toEqual(['permission-abort', 'provider-cancel']);
    });
});
