import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    MAX_WORKSPACE_UPLOAD_BYTES,
    MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH,
} from '@slopus/happy-wire';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
vi.mock('./sync', () => ({ sync: { refreshSessions: vi.fn() } }));
vi.mock('./storage', () => ({
    storage: { getState: vi.fn(() => ({ sessions: {} })) },
}));

describe('machine workspace upload transport', () => {
    beforeEach(() => {
        machineRPC.mockReset();
    });

    it('transfers the full 20 MiB contract as bounded, ordered RPC chunks', async () => {
        const uploadId = '11111111-1111-4111-8111-111111111111';
        const bytes = Buffer.alloc(MAX_WORKSPACE_UPLOAD_BYTES, 0x5a);
        const content = bytes.toString('base64');
        const receivedHash = createHash('sha256');
        const chunkLengths: number[] = [];
        let received = 0;

        machineRPC.mockImplementation(async (_machineId: string, method: string, request: any) => {
            if (method === 'uploadFileStart') {
                expect(request).toEqual({
                    directory: '/tmp/project ',
                    fileName: ' report.bin ',
                    size: MAX_WORKSPACE_UPLOAD_BYTES,
                });
                return { success: true, uploadId };
            }
            if (method === 'uploadFileChunk') {
                expect(request.uploadId).toBe(uploadId);
                expect(request.offset).toBe(received);
                chunkLengths.push(request.content.length);
                const chunk = Buffer.from(request.content, 'base64');
                receivedHash.update(chunk);
                received += chunk.length;
                return { success: true, received };
            }
            if (method === 'uploadFileFinish') {
                expect(request).toEqual({ uploadId });
                return {
                    success: true,
                    path: '/tmp/project / report.bin ',
                    size: received,
                    hash: receivedHash.digest('hex'),
                };
            }
            throw new Error(`Unexpected RPC method: ${method}`);
        });

        const { machineUploadFile } = await import('./ops');
        const response = await machineUploadFile('machine-1', {
            directory: '/tmp/project ',
            fileName: ' report.bin ',
            content,
        });

        expect(response.error).toBeUndefined();
        expect(response).toMatchObject({ success: true, size: MAX_WORKSPACE_UPLOAD_BYTES });
        expect(response.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(received).toBe(MAX_WORKSPACE_UPLOAD_BYTES);
        expect(chunkLengths.length).toBeGreaterThan(1);
        expect(Math.max(...chunkLengths)).toBe(MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH);
        expect(chunkLengths.every((length) => length <= MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH)).toBe(true);
    });

    it('best-effort aborts the temporary upload when a chunk fails', async () => {
        const uploadId = '22222222-2222-4222-8222-222222222222';
        machineRPC
            .mockResolvedValueOnce({ success: true, uploadId })
            .mockResolvedValueOnce({ success: false, code: 'write-failed', error: 'disk full' })
            .mockResolvedValueOnce({ success: true });

        const { machineUploadFile } = await import('./ops');
        await expect(machineUploadFile('machine-1', {
            directory: '/tmp/project',
            fileName: 'asset.bin',
            content: Buffer.from('content').toString('base64'),
        })).resolves.toEqual({ success: false, code: 'write-failed', error: 'disk full' });
        expect(machineRPC).toHaveBeenLastCalledWith('machine-1', 'uploadFileAbort', { uploadId });
    });
});
