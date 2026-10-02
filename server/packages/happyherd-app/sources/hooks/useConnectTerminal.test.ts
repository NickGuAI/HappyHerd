import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ approve: vi.fn(), alert: vi.fn() }));
vi.mock('react', () => ({
    useState: (value: unknown) => [value, vi.fn()],
    useRef: (value: unknown) => ({ current: value }),
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-camera', () => ({ CameraView: {} }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: { token: 'test-token', secret: 'AQID' } }) }));
vi.mock('@/encryption/libsodium', () => ({ encryptBox: () => new Uint8Array([1]) }));
vi.mock('@/auth/authApprove', () => ({ authApprove: mocks.approve }));
vi.mock('@/hooks/useCheckCameraPermissions', () => ({ useCheckScannerPermissions: () => vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: mocks.alert } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/sync', () => ({ sync: { encryption: { contentDataKey: new Uint8Array(32) } } }));
import { useConnectTerminal } from './useConnectTerminal';

const url = 'happyherd://terminal?AQID';

describe('manual terminal authorization submissions', () => {
    beforeEach(() => vi.resetAllMocks());

    it('allows only one in-flight submission even before React rerenders', async () => {
        let release!: () => void;
        mocks.approve.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
        const hook = useConnectTerminal();
        const first = hook.connectWithUrl(url);
        const duplicate = hook.processAuthUrl(url);
        expect(mocks.approve).toHaveBeenCalledTimes(1);
        release();
        await expect(first).resolves.toBe(true);
        await expect(duplicate).resolves.toBe(false);
        expect(mocks.alert).toHaveBeenCalledTimes(1);
    });

    it('reports failure without success, then permits a fresh retry', async () => {
        const error = new Error('request not found');
        mocks.approve.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
        const onError = vi.fn();
        const onSuccess = vi.fn();
        const hook = useConnectTerminal({ onError, onSuccess });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(hook.connectWithUrl(url)).resolves.toBe(false);
            expect(onError).toHaveBeenCalledWith(error);
            expect(onSuccess).not.toHaveBeenCalled();
            expect(mocks.alert).toHaveBeenLastCalledWith('common.error', 'modals.failedToConnectTerminal', [{ text: 'common.ok' }]);
            await expect(hook.connectWithUrl(url)).resolves.toBe(true);
            expect(mocks.approve).toHaveBeenCalledTimes(2);
            expect(mocks.alert.mock.lastCall?.[1]).toBe('modals.terminalConnectedSuccessfully');
        } finally {
            consoleError.mockRestore();
        }
    });
});
