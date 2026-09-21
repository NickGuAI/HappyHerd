import type { DirectoryTreeNode } from '@/sync/ops';

const utf8Encoder = new TextEncoder();

export function compareWorkspaceNamesBytewise(left: string, right: string): number {
    const leftBytes = utf8Encoder.encode(left);
    const rightBytes = utf8Encoder.encode(right);
    const sharedLength = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < sharedLength; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
    }
    return leftBytes.length - rightBytes.length;
}

export function sortWorkspaceContextTreeEntries(entries: readonly DirectoryTreeNode[]): DirectoryTreeNode[] {
    return [...entries].sort((left, right) => {
        if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
        return compareWorkspaceNamesBytewise(left.name, right.name);
    });
}
