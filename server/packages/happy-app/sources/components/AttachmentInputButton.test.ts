import { describe, expect, it } from 'vitest';

import { availableAttachmentInputActions } from './attachmentInputActions';

describe('availableAttachmentInputActions', () => {
    it('exposes photos and device files behind one attachment entry', () => {
        expect(availableAttachmentInputActions({ photos: true, deviceFiles: true })).toEqual([
            'photos',
            'device-files',
        ]);
    });
});
