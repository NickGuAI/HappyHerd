import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
vi.mock('./sync', () => ({ sync: { refreshSessions: vi.fn() } }));
vi.mock('./storage', () => ({
    storage: { getState: vi.fn(() => ({ sessions: {} })) },
}));

describe('machine rooted file read transport', () => {
    beforeEach(() => {
        machineRPC.mockReset();
    });

    it('calls only the distinct rooted-read RPC with both required paths', async () => {
        const response = { success: true, content: 'aW1hZ2U=' };
        machineRPC.mockResolvedValueOnce(response);
        const { machineReadFileWithinRoot } = await import('./ops');

        await expect(machineReadFileWithinRoot(
            'machine-origin',
            '/workspace/images/chart.png',
            '/workspace',
        )).resolves.toEqual(response);
        expect(machineRPC).toHaveBeenCalledOnce();
        expect(machineRPC).toHaveBeenCalledWith('machine-origin', 'readFileWithinRoot', {
            path: '/workspace/images/chart.png',
            rootPath: '/workspace',
        });
    });

    it.each([
        ['old daemon', 'RPC method not available'],
        ['missing daemon', 'The computer did not respond'],
    ])('fails inertly with no readFile fallback for an %s', async (_name, error) => {
        machineRPC.mockRejectedValueOnce(new Error(error));
        const { machineReadFileWithinRoot } = await import('./ops');

        await expect(machineReadFileWithinRoot(
            'machine-origin',
            '/workspace/images/chart.png',
            '/workspace',
        )).resolves.toEqual({ success: false, error });
        expect(machineRPC).toHaveBeenCalledOnce();
        expect(machineRPC.mock.calls[0]?.[1]).toBe('readFileWithinRoot');
    });
});
