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
