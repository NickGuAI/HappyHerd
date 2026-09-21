import { describe, expect, it, vi } from 'vitest';

import { selectMachineFileUploadAssets } from './machineFileUploadSelection';

describe('machine file upload selection', () => {
    it('turns a picker/provider rejection into an explicit result', async () => {
        const result = await selectMachineFileUploadAssets({
            pick: vi.fn().mockRejectedValue(new Error('Files provider unavailable')),
        });
        expect(result).toMatchObject({ status: 'error', error: new Error('Files provider unavailable') });
    });

    it('preflights the caller capacity before yielding any asset for upload', async () => {
        const assets = [
            { name: 'one.txt', uri: 'file:///one.txt' },
            { name: 'two.txt', uri: 'file:///two.txt' },
        ];
        const result = await selectMachineFileUploadAssets({
            maxFiles: 1,
            pick: vi.fn().mockResolvedValue({ cancelled: false, assets }),
        });
        expect(result).toEqual({ status: 'too-many', selectedCount: 2, maxFiles: 1 });
        expect(result).not.toHaveProperty('assets');
    });

    it('preserves literal picker names for the upload batch', async () => {
        const assets = [
            { name: 'a+b.txt', uri: 'file:///a+b.txt' },
            { name: 'a b.txt', uri: 'file:///a%20b.txt' },
        ];
        await expect(selectMachineFileUploadAssets({
            pick: vi.fn().mockResolvedValue({ cancelled: false, assets }),
        })).resolves.toEqual({ status: 'selected', assets });
    });
});
