import { describe, expect, it } from 'vitest';

import { formatDangerouslySkipPermissionsMetadata } from './sessionPermissionMetadata';

describe('formatDangerouslySkipPermissionsMetadata', () => {
    it('reports the provider receipt without treating OS sandboxing as permission bypass', () => {
        expect(formatDangerouslySkipPermissionsMetadata(false, 'plan')).toBe('Disabled');
        expect(formatDangerouslySkipPermissionsMetadata(false, 'default')).toBe('Disabled');
    });

    it('recognizes a legacy bypass mode when the explicit receipt is absent', () => {
        expect(formatDangerouslySkipPermissionsMetadata(undefined, 'bypassPermissions')).toBe('Enabled');
        expect(formatDangerouslySkipPermissionsMetadata(undefined, 'yolo')).toBe('Enabled');
        expect(formatDangerouslySkipPermissionsMetadata(undefined, 'plan')).toBe('Unknown');
    });
});
