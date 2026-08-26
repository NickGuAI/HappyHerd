import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketAckTimeoutError } from './socketAck';

const mocks = vi.hoisted(() => ({
    emitWithAck: vi.fn(),
    request: vi.fn(),
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
});
