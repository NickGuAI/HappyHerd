import { describe, expect, it, vi } from 'vitest';

import { runMachineFileUploadBatch, type MachineFileUploadAsset } from './machineFileUploadBatch';

const assets: MachineFileUploadAsset[] = [
    { name: 'one.txt', uri: 'file:///one.txt' },
    { name: 'two.txt', uri: 'file:///two.txt' },
    { name: 'three.txt', uri: 'file:///three.txt' },
];

describe('machine file upload batch', () => {
    it('stops after the current atomic host write and retains the remainder', async () => {
        let cancelled = false;
        const uploadOne = vi.fn(async (asset: MachineFileUploadAsset) => {
            cancelled = true;
            return `/workspace/${asset.name}`;
        });

        const result = await runMachineFileUploadBatch({
            assets,
            isCancelled: () => cancelled,
            uploadOne,
        });

        expect(result.status).toBe('cancelled');
        expect(result.uploaded).toEqual(['/workspace/one.txt']);
        expect(result.pending.map((asset) => asset.name)).toEqual(['two.txt', 'three.txt']);
        expect(uploadOne).toHaveBeenCalledTimes(1);
    });

    it('retains the failed file and untouched remainder for retry', async () => {
        const uploadOne = vi.fn(async (asset: MachineFileUploadAsset) => {
            if (asset.name === 'two.txt') throw new Error('offline');
            return `/workspace/${asset.name}`;
        });

        const result = await runMachineFileUploadBatch({
            assets,
            isCancelled: () => false,
            uploadOne,
        });

        expect(result.status).toBe('error');
        expect(result.uploaded).toEqual(['/workspace/one.txt']);
        expect(result.pending.map((asset) => asset.name)).toEqual(['two.txt', 'three.txt']);
        expect(result.error).toEqual(new Error('offline'));
    });

    it('reports ordered progress and every completed host path', async () => {
        const onProgress = vi.fn();
        const onUploaded = vi.fn();

        const result = await runMachineFileUploadBatch({
            assets: assets.slice(0, 2),
            isCancelled: () => false,
            uploadOne: async (asset) => `/workspace/${asset.name}`,
            onProgress,
            onUploaded,
        });

        expect(result.status).toBe('complete');
        expect(result.pending).toEqual([]);
        expect(onProgress.mock.calls).toEqual([
            [0, 2, 'one.txt'],
            [1, 2, 'two.txt'],
        ]);
        expect(onUploaded.mock.calls).toEqual([
            ['/workspace/one.txt'],
            ['/workspace/two.txt'],
        ]);
    });
});
