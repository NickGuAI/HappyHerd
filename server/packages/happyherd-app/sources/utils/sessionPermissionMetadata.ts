export function formatDangerouslySkipPermissionsMetadata(
    value: unknown,
    permissionMode: string | null | undefined,
): string {
    if (typeof value === 'boolean') {
        return value ? 'Enabled' : 'Disabled';
    }

    if (permissionMode === 'bypassPermissions' || permissionMode === 'yolo') {
        return 'Enabled';
    }

    return 'Unknown';
}
