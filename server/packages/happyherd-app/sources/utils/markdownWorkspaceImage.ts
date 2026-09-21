import { machineReadFileWithinRoot } from '@/sync/ops';

import {
    imageDataUri,
    imageMimeType,
    matchesRichPreviewContent,
} from './filePreview';
import type { MarkdownWorkspaceImageReference } from './markdownWorkspaceLink';

type ReadMachineFileWithinRoot = typeof machineReadFileWithinRoot;

function decodeBase64(base64: string): Uint8Array | null {
    if (
        base64.length === 0
        || base64.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) {
        return null;
    }
    try {
        return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

export async function loadMarkdownWorkspaceImage(
    reference: MarkdownWorkspaceImageReference,
    readFileWithinRoot: ReadMachineFileWithinRoot = machineReadFileWithinRoot,
): Promise<string | null> {
    const { machineId, absolutePath } = reference.workspaceRoute.params;
    if (!imageMimeType(absolutePath)) return null;

    try {
        const response = await readFileWithinRoot(machineId, absolutePath, reference.rootPath);
        if (!response.success || typeof response.content !== 'string') return null;

        const bytes = decodeBase64(response.content);
        if (!bytes || !matchesRichPreviewContent(absolutePath, bytes)) return null;

        return imageDataUri(absolutePath, response.content);
    } catch {
        return null;
    }
}
