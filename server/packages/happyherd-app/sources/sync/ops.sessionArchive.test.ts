import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketAckTimeoutError } from './socketAck';

const mocks = vi.hoisted(() => ({
    emitWithAck: vi.fn(),
    request: vi.fn(),
    machineRPC: vi.fn(),
    sessionRPC: vi.fn(),
    refreshSessions: vi.fn(),
    encryptRaw: vi.fn(),
    decryptRaw: vi.fn(),
    getSessionEncryption: vi.fn(),
    getState: vi.fn(),
}));

vi.mock('./apiSocket', () => ({
    apiSocket: {
        emitWithAck: mocks.emitWithAck,
        request: mocks.request,
        machineRPC: mocks.machineRPC,
        sessionRPC: mocks.sessionRPC,
    },
}));

vi.mock('./sync', () => ({
    sync: {
        encryption: { getSessionEncryption: mocks.getSessionEncryption },
        refreshSessions: mocks.refreshSessions,
    },
}));

vi.mock('./storage', () => ({
    storage: { getState: mocks.getState },
}));

vi.mock('@/text', () => ({ t: (key: string) => key }));

describe('sessionArchive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSessionEncryption.mockReturnValue({
            encryptRaw: mocks.encryptRaw,
            decryptRaw: mocks.decryptRaw,
        });
        mocks.getState.mockReturnValue({
            sessions: {
                child: {
                    id: 'child',
                    metadataVersion: 4,
                    metadata: {
                        path: '/srv/project',
                        host: 'machine-one',
                        isSideChat: true,
                        parentSessionId: 'parent',
                        lifecycleState: 'running',
                    },
                },
            },
        });
        mocks.encryptRaw.mockImplementation(async (value) => JSON.stringify(value));
        mocks.emitWithAck.mockResolvedValue({ result: 'success', version: 5 });
        mocks.request.mockResolvedValue({ ok: true, status: 200 });
        mocks.machineRPC.mockResolvedValue({
            schemaVersion: 1,
            type: 'side-chat-close-all',
            action: 'close-all',
            success: true,
            parentSessionId: 'parent',
            total: 0,
            closed: 0,
            failed: 0,
            children: [],
        });
        mocks.sessionRPC.mockResolvedValue({ success: true, message: 'Session terminated' });
        mocks.refreshSessions.mockResolvedValue(undefined);
    });

    it('deactivates before persisting the explicit encrypted archive marker', async () => {
        const { sessionArchive } = await import('./ops');

        await expect(sessionArchive('child')).resolves.toEqual({ success: true });

        expect(mocks.encryptRaw).toHaveBeenCalledWith(expect.objectContaining({
            path: '/srv/project',
            parentSessionId: 'parent',
            lifecycleState: 'archived',
            lifecycleStateSince: expect.any(Number),
            archivedBy: 'app',
        }));
        expect(mocks.emitWithAck).toHaveBeenCalledWith(
            'update-metadata',
            expect.objectContaining({
                sid: 'child',
                expectedVersion: 4,
            }),
            10_000,
        );
        expect(mocks.request).toHaveBeenCalledWith('/v1/sessions/child/archive', { method: 'POST' });
        expect(mocks.request.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.emitWithAck.mock.invocationCallOrder[0]);
    });

    it('merges the explicit archive marker into newer metadata after a version conflict', async () => {
        mocks.emitWithAck
            .mockResolvedValueOnce({ result: 'version-mismatch', version: 8, metadata: 'encrypted-latest' })
            .mockResolvedValueOnce({ result: 'success', version: 9 });
        mocks.decryptRaw.mockResolvedValue({
            path: '/srv/project',
            host: 'machine-one',
            summary: { text: 'Newest title', updatedAt: 10 },
            lifecycleState: 'running',
        });
        const { sessionArchive } = await import('./ops');

        await expect(sessionArchive('child')).resolves.toEqual({ success: true });

        expect(mocks.encryptRaw).toHaveBeenLastCalledWith(expect.objectContaining({
            summary: { text: 'Newest title', updatedAt: 10 },
            lifecycleState: 'archived',
        }));
        expect(mocks.emitWithAck).toHaveBeenLastCalledWith(
            'update-metadata',
            expect.objectContaining({ expectedVersion: 8 }),
            10_000,
        );
    });

    it('still deactivates but reports failure when durable metadata persistence fails', async () => {
        mocks.emitWithAck.mockResolvedValue({ result: 'error' });
        const { sessionArchive } = await import('./ops');

        await expect(sessionArchive('child')).resolves.toEqual({
            success: false,
            message: 'Failed to update session metadata',
        });

        expect(mocks.request).toHaveBeenCalledWith('/v1/sessions/child/archive', { method: 'POST' });
        expect(mocks.refreshSessions).toHaveBeenCalledOnce();
    });

    it('confirms a committed archive when the metadata handler returns an error afterward', async () => {
        mocks.emitWithAck.mockResolvedValue({ result: 'error' });
        mocks.refreshSessions.mockImplementation(async () => {
            mocks.getState.mockReturnValue({
                sessions: {
                    child: {
                        id: 'child',
                        metadataVersion: 5,
                        metadata: {
                            path: '/srv/project',
                            parentSessionId: 'parent',
                            lifecycleState: 'archived',
                        },
                    },
                },
            });
        });
        const { sessionArchive } = await import('./ops');

        await expect(sessionArchive('child')).resolves.toEqual({ success: true });
        expect(mocks.refreshSessions).toHaveBeenCalledOnce();
    });

    it('bounds a lost metadata ack and confirms the applied archive by read-back', async () => {
        vi.useFakeTimers();
        let ackStarted!: () => void;
        const started = new Promise<void>((resolve) => { ackStarted = resolve; });
        mocks.emitWithAck.mockImplementation((_event, _data, timeoutMs) => {
            ackStarted();
            return new Promise((_resolve, reject) => {
                setTimeout(
                    () => reject(new SocketAckTimeoutError('update-metadata')),
                    timeoutMs,
                );
            });
        });
        mocks.refreshSessions.mockImplementation(async () => {
            mocks.getState.mockReturnValue({
                sessions: {
                    child: {
                        id: 'child',
                        metadataVersion: 5,
                        metadata: {
                            path: '/srv/project',
                            parentSessionId: 'parent',
                            lifecycleState: 'archived',
                        },
                    },
                },
            });
        });
        const { sessionArchive } = await import('./ops');

        const archive = sessionArchive('child');
        await started;
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(archive).resolves.toEqual({ success: true });
        expect(mocks.refreshSessions).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });

    it('resolves a lost metadata ack as failure when read-back is not archived', async () => {
        vi.useFakeTimers();
        let ackStarted!: () => void;
        const started = new Promise<void>((resolve) => { ackStarted = resolve; });
        mocks.emitWithAck.mockImplementation((_event, _data, timeoutMs) => {
            ackStarted();
            return new Promise((_resolve, reject) => {
                setTimeout(
                    () => reject(new SocketAckTimeoutError('update-metadata')),
                    timeoutMs,
                );
            });
        });
        const { sessionArchive } = await import('./ops');

        const archive = sessionArchive('child');
        await started;
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(archive).resolves.toEqual({
            success: false,
            message: 'Socket acknowledgement timed out for update-metadata',
        });
        expect(mocks.refreshSessions).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });

    it('does not hide the child when server deactivation fails', async () => {
        mocks.request.mockResolvedValue({ ok: false, status: 503 });
        const { sessionArchive } = await import('./ops');

        await expect(sessionArchive('child')).resolves.toEqual({
            success: false,
            message: 'Server error: 503',
        });

        expect(mocks.emitWithAck).not.toHaveBeenCalled();
    });

    it('refuses server archive and permanent deletion for a bot before any request or metadata write', async () => {
        mocks.getState.mockReturnValue({
            sessions: {
                bot: {
                    id: 'bot',
                    metadataVersion: 4,
                    metadata: {
                        path: '/srv/bot',
                        host: 'machine-one',
                        commanderId: 'commander-one',
                        isSuperSession: true,
                        bot: {
                            id: 'bot-1',
                            name: 'Build assistant',
                            username: 'build-assistant',
                            workspaceId: 'workspace-1',
                            orderKey: 'a0',
                        },
                    },
                },
            },
        });
        const { sessionArchive, sessionDelete } = await import('./ops');

        await expect(sessionArchive('bot')).resolves.toEqual({
            success: false,
            message: 'sessionInfo.botArchiveRequiresMachine',
        });
        await expect(sessionDelete('bot')).resolves.toEqual({
            success: false,
            message: 'sessionInfo.botDeleteUnavailable',
        });

        expect(mocks.request).not.toHaveBeenCalled();
        expect(mocks.encryptRaw).not.toHaveBeenCalled();
        expect(mocks.emitWithAck).not.toHaveBeenCalled();
        expect(mocks.refreshSessions).not.toHaveBeenCalled();
    });

    it('closes the daemon child snapshot before killing the parent', async () => {
        const { archiveSessionWithSideChats } = await import('./ops');

        await expect(archiveSessionWithSideChats('parent', { machineId: 'machine-one' } as any)).resolves.toEqual({ success: true });

        expect(mocks.machineRPC).toHaveBeenCalledWith(
            'machine-one',
            'happyherd-side-chat-close-all',
            { parentSessionId: 'parent' },
        );
        expect(mocks.machineRPC.mock.invocationCallOrder[0]).toBeLessThan(mocks.sessionRPC.mock.invocationCallOrder[0]);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('keeps the parent visible when a direct child close fails', async () => {
        mocks.machineRPC.mockResolvedValue({
            schemaVersion: 1,
            type: 'side-chat-close-all',
            action: 'close-all',
            success: false,
            parentSessionId: 'parent',
            total: 1,
            closed: 0,
            failed: 1,
            children: [{ success: false, sessionId: 'child' }],
        });
        const { archiveSessionWithSideChats } = await import('./ops');

        await expect(archiveSessionWithSideChats('parent', { machineId: 'machine-one' } as any)).resolves.toEqual({ success: false });

        expect(mocks.sessionRPC).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('uses the server archive fallback after closing children when the parent is stopped', async () => {
        mocks.sessionRPC.mockResolvedValue({ success: false, message: 'Session not connected' });
        mocks.getState.mockReturnValue({
            sessions: {
                parent: {
                    id: 'parent',
                    metadataVersion: 4,
                    metadata: { path: '/srv/project', machineId: 'machine-one' },
                },
            },
        });
        const { archiveSessionWithSideChats } = await import('./ops');

        await expect(archiveSessionWithSideChats('parent', { machineId: 'machine-one' } as any)).resolves.toEqual({ success: true });

        expect(mocks.machineRPC).toHaveBeenCalledOnce();
        expect(mocks.sessionRPC).toHaveBeenCalledOnce();
        expect(mocks.request).toHaveBeenCalledWith('/v1/sessions/parent/archive', { method: 'POST' });
    });

    it('keeps Rig archive on its externally owned lifecycle without a native close-all RPC', async () => {
        const { archiveSessionWithSideChats } = await import('./ops');

        await expect(archiveSessionWithSideChats('rig-parent', { client: { id: 'rig' } } as any))
            .resolves.toEqual({ success: true });

        expect(mocks.machineRPC).not.toHaveBeenCalled();
        expect(mocks.sessionRPC).toHaveBeenCalledOnce();
    });
});
