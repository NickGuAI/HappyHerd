import { describe, expect, it } from 'vitest';
import { workspaceUploadFailureMessage } from './machineFileUpload';

describe('machine file upload presentation', () => {
    it('keeps the filename and daemon conflict reason visible', () => {
        expect(workspaceUploadFailureMessage('report.pdf', {
            success: false,
            code: 'conflict',
            error: 'A file with this name already exists',
        })).toBe('report.pdf: A file with this name already exists');
    });
});
