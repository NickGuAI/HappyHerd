import { describe, expect, it } from 'vitest';
import { classifyFilePreview, imageDataUri, imageMimeType } from './filePreview';

describe('file preview classification', () => {
    it('recognizes common images with correct MIME types', () => {
        expect(classifyFilePreview('art/photo.JPEG')).toBe('image');
        expect(imageMimeType('diagram.svg')).toBe('image/svg+xml');
        expect(imageDataUri('icon.png', 'AAAA')).toBe('data:image/png;base64,AAAA');
    });

    it('keeps text readable and marks unsupported binaries explicitly', () => {
        expect(classifyFilePreview('src/index.ts')).toBe('text');
        expect(classifyFilePreview('report.pdf')).toBe('unsupported');
    });
});
