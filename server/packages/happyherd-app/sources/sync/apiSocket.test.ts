import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppState } from 'react-native';
import { apiSocket } from './apiSocket';
import type { Encryption } from './encryption/encryption';

const { io } = vi.hoisted(() => ({ io: vi.fn() }));
vi.mock('socket.io-client', () => ({ io }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.2.3' } } }));
vi.mock('@/auth/tokenStorage', () => ({ TokenStorage: {} }));
vi.mock('./storage', () => ({ storage: { getState: () => ({ settings: {} }) } }));

describe('app socket handshake compatibility', () => {
    afterEach(() => {
        apiSocket.disconnect();
        AppState.currentState = 'active';
        vi.clearAllMocks();
    });

    it('sends the established client identity key on initial connection and reconnect', () => {
        io.mockReturnValue({ on: vi.fn(), onAny: vi.fn(), disconnect: vi.fn() });
        apiSocket.initialize({ endpoint: 'https://server.test', token: 'test-token' }, {} as Encryption);
        const sendAuth = io.mock.calls[0][1].auth;
        const receiveAuth = vi.fn();

        sendAuth(receiveAuth);
        expect(receiveAuth).toHaveBeenLastCalledWith({
            token: 'test-token', clientType: 'user-scoped', happyClient: 'ios/1.2.3', appState: 'active',
        });

        AppState.currentState = 'background';
        sendAuth(receiveAuth);
        expect(receiveAuth).toHaveBeenLastCalledWith({
            token: 'test-token', clientType: 'user-scoped', happyClient: 'ios/1.2.3', appState: 'background',
        });
    });
});

describe('session RPC diagnostic boundaries', () => {
    afterEach(() => { apiSocket.disconnect(); vi.clearAllMocks(); });

    function fixture() {
        const emitWithAck = vi.fn().mockResolvedValue({ ok: true, result: 'encrypted-answer' });
        const timeout = vi.fn(() => ({ emitWithAck }));
        const encryptRaw = vi.fn().mockResolvedValue('encrypted-request');
        const decryptRaw = vi.fn().mockResolvedValue({ answer: 42 });
        io.mockReturnValue({ on: vi.fn(), onAny: vi.fn(), disconnect: vi.fn(), timeout });
        apiSocket.initialize({ endpoint: 'https://server.test', token: 'test-token' }, {
            getSessionEncryption: () => ({ encryptRaw, decryptRaw }),
        } as unknown as Encryption);
        return { emitWithAck, timeout, encryptRaw, decryptRaw };
    }

    it.each([
        ['encryptRaw', 'encrypting the request'],
        ['emitWithAck', 'waiting for the answer'],
        ['decryptRaw', 'reading the answer'],
    ] as const)('identifies %s failures without changing the acknowledgment transport', async (failing, stage) => {
        const f = fixture();
        f[failing].mockRejectedValueOnce(new Error('fixture failure'));
        await expect(apiSocket.sessionRPC('session', 'method', { private: 'value' })).rejects.toThrow(`${stage}: fixture failure`);
        if (failing === 'encryptRaw') expect(f.emitWithAck).not.toHaveBeenCalled();
        else {
            expect(f.timeout).toHaveBeenCalledExactlyOnceWith(50_000);
            expect(f.emitWithAck).toHaveBeenCalledExactlyOnceWith('rpc-call', { method: 'session:method', params: 'encrypted-request' });
        }
    });

    it('distinguishes a synchronous send failure from an acknowledgment failure', async () => {
        const f = fixture();
        f.emitWithAck.mockImplementationOnce(() => { throw new Error('emit failure'); });
        await expect(apiSocket.sessionRPC('session', 'method', {})).rejects.toThrow('sending the request: emit failure');
        expect(f.decryptRaw).not.toHaveBeenCalled();
    });

    it('returns the decrypted response and retains the remote error', async () => {
        const f = fixture();
        await expect(apiSocket.sessionRPC('session', 'method', {})).resolves.toEqual({ answer: 42 });
        expect(f.decryptRaw).toHaveBeenCalledExactlyOnceWith('encrypted-answer');
        f.emitWithAck.mockResolvedValueOnce({ ok: false, error: 'Remote refusal' });
        await expect(apiSocket.sessionRPC('session', 'method', {})).rejects.toThrow(/^Remote refusal$/);
        expect(f.decryptRaw).toHaveBeenCalledOnce();
    });
});
