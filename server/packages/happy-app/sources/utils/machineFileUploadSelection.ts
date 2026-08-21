import { MAX_WORKSPACE_UPLOAD_FILES } from '@slopus/happy-wire';
import type { MachineFileUploadAsset } from './machineFileUploadBatch';

export type MachineFileUploadSelection =
    | { status: 'selected'; assets: MachineFileUploadAsset[] }
    | { status: 'cancelled' }
    | { status: 'too-many'; selectedCount: number; maxFiles: number }
    | { status: 'error'; error: unknown };

export async function selectMachineFileUploadAssets(options: {
    maxFiles?: number;
    pick: () => Promise<{ cancelled: boolean; assets?: MachineFileUploadAsset[] }>;
}): Promise<MachineFileUploadSelection> {
    const maxFiles = Math.max(0, Math.min(options.maxFiles ?? MAX_WORKSPACE_UPLOAD_FILES, MAX_WORKSPACE_UPLOAD_FILES));
    let result: { cancelled: boolean; assets?: MachineFileUploadAsset[] };
    try {
        result = await options.pick();
    } catch (error) {
        return { status: 'error', error };
    }
    if (result.cancelled) return { status: 'cancelled' };
    const assets = result.assets ?? [];
    if (assets.length > maxFiles) {
        return { status: 'too-many', selectedCount: assets.length, maxFiles };
    }
    return { status: 'selected', assets };
}
