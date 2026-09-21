export type MachineFileUploadAsset = {
    name: string;
    uri: string;
    size?: number | null;
};

export type MachineFileUploadBatchResult = {
    status: 'complete' | 'cancelled' | 'error';
    uploaded: string[];
    pending: MachineFileUploadAsset[];
    error?: unknown;
};

/**
 * Runs one ordered upload batch. Cancellation is cooperative: an in-flight
 * host write finishes atomically, then the remaining files stay available for
 * an explicit retry.
 */
export async function runMachineFileUploadBatch(options: {
    assets: MachineFileUploadAsset[];
    isCancelled: () => boolean;
    uploadOne: (asset: MachineFileUploadAsset) => Promise<string>;
    onUploaded?: (path: string) => void;
    onProgress?: (completed: number, total: number, currentFile: string) => void;
}): Promise<MachineFileUploadBatchResult> {
    const uploaded: string[] = [];

    for (let index = 0; index < options.assets.length; index += 1) {
        if (options.isCancelled()) {
            return {
                status: 'cancelled',
                uploaded,
                pending: options.assets.slice(index),
            };
        }

        const asset = options.assets[index];
        options.onProgress?.(uploaded.length, options.assets.length, asset.name);
        try {
            const path = await options.uploadOne(asset);
            uploaded.push(path);
            options.onUploaded?.(path);
        } catch (error) {
            return {
                status: 'error',
                uploaded,
                pending: options.assets.slice(index),
                error,
            };
        }

        if (options.isCancelled()) {
            return {
                status: 'cancelled',
                uploaded,
                pending: options.assets.slice(index + 1),
            };
        }
    }

    return {
        status: 'complete',
        uploaded,
        pending: [],
    };
}
