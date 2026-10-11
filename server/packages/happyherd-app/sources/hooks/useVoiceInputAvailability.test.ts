import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVoiceInputAvailability } from './voiceInputAvailability';

const availabilityMocks = vi.hoisted(() => ({
    credentials: { token: 'account-token' },
    localEnabled: true,
    machineId: 'voice-machine',
    machineOnline: true,
    localState: 'ready' as string,
    keyStatus: vi.fn(),
}));

vi.mock('@react-navigation/native', async () => {
    const ReactModule = await import('react');
    return { useFocusEffect: (callback: () => void | (() => void)) => ReactModule.useEffect(callback, [callback]) };
});
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: availabilityMocks.credentials }) }));
vi.mock('@/sync/apiVoice', () => ({ fetchVoiceTranscriptionKeyStatus: availabilityMocks.keyStatus }));
vi.mock('@/sync/storage', () => ({
    useSetting: (key: string) => key === 'localVoiceSttEnabled' ? availabilityMocks.localEnabled : availabilityMocks.machineId,
    useMachine: () => ({ active: availabilityMocks.machineOnline }),
}));
vi.mock('@/hooks/useLocalVoiceStatus', () => ({ useLocalVoiceStatus: () => ({ status: { stt: { state: availabilityMocks.localState } } }) }));

import { useVoiceInputAvailability } from './useVoiceInputAvailability';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(() => {
    availabilityMocks.credentials = { token: 'account-token' };
    availabilityMocks.localEnabled = true;
    availabilityMocks.machineId = 'voice-machine';
    availabilityMocks.machineOnline = true;
    availabilityMocks.localState = 'ready';
    availabilityMocks.keyStatus.mockReset();
});

describe('resolveVoiceInputAvailability', () => {
    it.each([
        { configured: false, localReady: false, available: false },
        { configured: true, localReady: false, available: true },
        { configured: false, localReady: true, available: true },
        { configured: true, localReady: true, available: true },
    ])('resolves cloud and local readiness independently', ({ configured, localReady, available }) => {
        expect(resolveVoiceInputAvailability(configured, localReady)).toBe(available);
    });
});

describe('useVoiceInputAvailability', () => {
    it('keeps a ready local engine available when checking cloud-key status fails', async () => {
        availabilityMocks.keyStatus.mockRejectedValue(new Error('key status unavailable'));
        let current!: ReturnType<typeof useVoiceInputAvailability>;
        function Harness() {
            current = useVoiceInputAvailability();
            return null;
        }

        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(Harness));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(availabilityMocks.keyStatus).toHaveBeenCalledOnce();
        expect(current).toMatchObject({
            configured: false,
            loading: false,
            localReady: true,
            localMachineId: 'voice-machine',
            available: true,
        });
        act(() => renderer.unmount());
    });
});
