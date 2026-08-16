import type { WorkspaceUploadResponse } from '@slopus/happy-wire';

export function workspaceUploadFailureMessage(
    fileName: string,
    response: WorkspaceUploadResponse,
    fallback = 'Upload failed',
): string {
    return `${fileName}: ${response.error ?? fallback}`;
}
