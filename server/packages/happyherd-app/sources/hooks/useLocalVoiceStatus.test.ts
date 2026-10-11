import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    machine: { online: true },
    status: vi.fn(),
}));

vi.mock('@/sync/storage', () => ({ useMachine: () => state.machine }));
vi.mock('@/sync/localVoice', () => ({ localVoiceStatus: state.status }));
vi.mock('@/utils/machineUtils', () => ({ isMachineOnline: (machine: { online: boolean }) => machine.online }));

import { useLocalVoiceStatus } from './useLocalVoiceStatus';

type HookValue = ReturnType<typeof useLocalVoiceStatus>;

describe('useLocalVoiceStatus', () => {
    let current: HookValue;

    function Harness() {
        current = useLocalVoiceStatus('voice-status-test-machine');
        return null;
    }

    beforeEach(() => {
        state.machine = { online: true };
        state.status.mockReset().mockResolvedValue({ stt: { state: 'ready' }, tts: { state: 'ready' } });
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    it('clears a previously ready status when the current refresh fails', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(Harness));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(current.status?.tts.state).toBe('ready');

        state.status.mockRejectedValueOnce(new Error('voice status transport failed'));
        await act(async () => { await current.refresh(); });

        expect(current.status).toBeNull();
        expect(current.error).toBe('voice status transport failed');
        expect(current.online).toBe(true);
        await act(async () => { renderer.unmount(); });
    });

    it('uses the shared machine-online predicate before exposing a cached status', async () => {
        state.machine = { online: false };
        let renderer!: ReturnType<typeof create>;
        await act(async () => { renderer = create(React.createElement(Harness)); });

        expect(current.online).toBe(false);
        expect(current.status).toBeNull();
        expect(state.status).not.toHaveBeenCalled();
        await act(async () => { renderer.unmount(); });
    });
});
