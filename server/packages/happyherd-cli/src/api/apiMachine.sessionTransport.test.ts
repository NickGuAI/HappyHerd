import { describe, expect, it, vi } from 'vitest';
import { ApiMachineClient } from './apiMachine';
import { SessionTransportRecovery } from '@/daemon/sessionTransport';

describe('machine transport recovery RPC', () => {
    it('dispatches only to the existing owner and never resumes, spawns or stops a process', async () => {
        const client = new ApiMachineClient('test-token', {
            id: 'machine', encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy', metadata: null,
        } as any);
        const transport = new SessionTransportRecovery({
            endpoint: 'https://current.example',
            owner: id => id === 'session' ? { pid: 22, isSuperSession: true, running: true } : undefined,
        });
        transport.exchange({ sessionId: 'session', pid: 22,
            transport: { endpoint: 'https://old.example', state: 'error', errorCode: 'dns', updatedAt: 1 } });
        const spawnSession = vi.fn(), resumeSession = vi.fn(), stopSession = vi.fn();
        client.setRPCHandlers({ sessionTransport: transport, spawnSession, resumeSession, stopSession, requestShutdown: vi.fn() });
        const handlers = (client as any).rpcHandlerManager.handlers as Map<string, (params: unknown) => Promise<unknown>>;
        const status = handlers.get('machine:session-transport-status')!;
        const recover = handlers.get('machine:recover-session-transport')!;
        expect(await status({ sessionId: 'session' })).toMatchObject({ state: 'disconnected', canRecover: true });
        expect(await recover({ sessionId: 'session' })).toMatchObject({ state: 'reconnecting' });
        for (const handler of [status, recover]) {
            await expect(handler({ sessionId: '' })).rejects.toThrow('sessionId is required');
            await expect(handler({})).rejects.toThrow('sessionId is required');
            expect(await handler({ sessionId: 'unowned' })).toMatchObject({ state: 'disconnected', canRecover: false });
        }
        expect(spawnSession).not.toHaveBeenCalled();
        expect(resumeSession).not.toHaveBeenCalled();
        expect(stopSession).not.toHaveBeenCalled();
    });
});
