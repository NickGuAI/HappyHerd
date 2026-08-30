import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rigMetadataFixture } from './__testdata__/rigMetadata';

const { machineRPC, sessionRPC, getState } = vi.hoisted(() => ({
    machineRPC: vi.fn(),
    sessionRPC: vi.fn(),
    getState: vi.fn(),
}));

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC, sessionRPC } }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: { getState } }));

describe('Rig session RPC capability gates', () => {
    beforeEach(() => {
        sessionRPC.mockReset();
        sessionRPC.mockResolvedValue({ aborted: true });
        machineRPC.mockReset();
        getState.mockReturnValue({
            sessions: { rig: { metadata: rigMetadataFixture } },
        });
    });

    it('calls the encrypted session-scoped abort RPC with an empty payload', async () => {
        const { sessionAbort } = await import('./ops');
        await sessionAbort('rig');
        expect(sessionRPC).toHaveBeenCalledWith('rig', 'abort', {});
    });

    it('does not call RPC methods that disappear after metadata refresh', async () => {
        getState.mockReturnValue({
            sessions: {
                rig: {
                    metadata: {
                        ...rigMetadataFixture,
                        capabilities: {
                            ...rigMetadataFixture.capabilities!,
                            files: { ...rigMetadataFixture.capabilities!.files, write: false },
                            rpcMethods: ['abort', 'bash', 'readFile', 'ripgrep'],
                        },
                    },
                },
            },
        });
        const { sessionWriteFile } = await import('./ops');
        await expect(sessionWriteFile('rig', '/tmp/a', 'YQ==', null)).resolves.toMatchObject({
            success: false,
            error: 'File writing is not available for this session',
        });
        expect(sessionRPC).not.toHaveBeenCalled();
    });

    it('never invokes unadvertised directory RPC helpers for Rig', async () => {
        const { sessionGetDirectoryTree, sessionListDirectory } = await import('./ops');
        expect(await sessionListDirectory('rig', '.')).toMatchObject({ success: false });
        expect(await sessionGetDirectoryTree('rig', '.', 2)).toMatchObject({ success: false });
        expect(sessionRPC).not.toHaveBeenCalled();
    });

    it('does not invoke deleteFile when a Rig session does not advertise it', async () => {
        const { sessionDeleteFile } = await import('./ops');

        await expect(sessionDeleteFile('rig', '/tmp/remove.md')).resolves.toEqual({
            success: false,
            error: 'File deletion is not advertised by this Rig session',
        });
        expect(sessionRPC).not.toHaveBeenCalled();
    });

    it('does not infer deleteFile support for a branded pre-v1 Rig session', async () => {
        getState.mockReturnValue({
            sessions: {
                rig: {
                    metadata: {
                        path: '/tmp',
                        host: 'legacy-rig',
                        client: { id: 'rig', name: 'Rig', version: '0.9.0' },
                    },
                },
            },
        });
        const { sessionDeleteFile } = await import('./ops');

        await expect(sessionDeleteFile('rig', '/tmp/remove.md')).resolves.toEqual({
            success: false,
            error: 'File deletion is not advertised by this Rig session',
        });
        expect(sessionRPC).not.toHaveBeenCalled();
    });

    it('forwards deleteFile through the session RPC when Rig advertises it', async () => {
        getState.mockReturnValue({
            sessions: {
                rig: {
                    metadata: {
                        ...rigMetadataFixture,
                        capabilities: {
                            ...rigMetadataFixture.capabilities!,
                            rpcMethods: [...rigMetadataFixture.capabilities!.rpcMethods, 'deleteFile'],
                        },
                    },
                },
            },
        });
        sessionRPC.mockResolvedValueOnce({ success: true });
        const { sessionDeleteFile } = await import('./ops');

        await expect(sessionDeleteFile('rig', '/tmp/remove.md')).resolves.toEqual({ success: true });
        expect(sessionRPC).toHaveBeenCalledWith('rig', 'deleteFile', { path: '/tmp/remove.md' });
    });

    it('enables machine-scoped deletion for an old session after its daemon advertises support', async () => {
        getState.mockReturnValue({
            sessions: {
                old: { metadata: { path: '/tmp', host: 'old', machineId: 'machine-1' } },
            },
            machines: { 'machine-1': { metadata: { supportsFileDelete: false } } },
        });
        machineRPC.mockResolvedValue({ success: true });
        const { sessionDeleteFile } = await import('./ops');

        await expect(sessionDeleteFile('old', '/tmp/old.md')).resolves.toEqual({
            success: false,
            error: 'File deletion is not available for this session',
        });
        expect(machineRPC).not.toHaveBeenCalled();

        getState.mockReturnValue({
            sessions: {
                old: { metadata: { path: '/tmp', host: 'old', machineId: 'machine-1' } },
            },
            machines: { 'machine-1': { metadata: { supportsFileDelete: true } } },
        });

        await expect(sessionDeleteFile('old', '/tmp/old.md')).resolves.toEqual({ success: true });
        expect(machineRPC).toHaveBeenCalledOnce();
        expect(machineRPC).toHaveBeenCalledWith('machine-1', 'deleteFile', { path: '/tmp/old.md' });
        expect(sessionRPC).not.toHaveBeenCalled();
    });
});
