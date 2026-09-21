import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
vi.mock('./sync', () => ({ sync: { refreshSessions: vi.fn() } }));
vi.mock('./storage', () => ({
    storage: { getState: vi.fn(() => ({ sessions: {} })) },
}));

describe('machine workspace file write transport', () => {
    beforeEach(() => {
        machineRPC.mockReset();
    });

    it('forwards the exact selected path, content, and expected hash', async () => {
        const response = { success: true, hash: 'saved-hash' };
        machineRPC.mockResolvedValueOnce(response);
        const { machineWriteFile } = await import('./ops');

        await expect(machineWriteFile(
            'owner-machine',
            '/work/report.md',
            'IyBVcGRhdGVkCg==',
            'original-hash',
        )).resolves.toEqual(response);
        expect(machineRPC).toHaveBeenCalledOnce();
        expect(machineRPC).toHaveBeenCalledWith('owner-machine', 'writeFile', {
            path: '/work/report.md',
            content: 'IyBVcGRhdGVkCg==',
            expectedHash: 'original-hash',
        });
    });
});
