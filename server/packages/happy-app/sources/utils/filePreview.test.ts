import { describe, expect, it } from 'vitest';
import {
    classifyFilePreview,
    documentPreviewWebSandbox,
    imageDataUri,
    imageMimeType,
    imagePreviewLayout,
    pdfDataUri,
    safeHtmlPreviewDocument,
} from './filePreview';

describe('file preview classification', () => {
    it('recognizes common images with correct MIME types', () => {
        expect(classifyFilePreview('art/photo.JPEG')).toBe('image');
        expect(imageMimeType('diagram.svg')).toBe('image/svg+xml');
        expect(imageDataUri('icon.png', 'AAAA')).toBe('data:image/png;base64,AAAA');
    });

    it('gives decoded images a non-zero responsive preview surface', () => {
        expect(imagePreviewLayout).toEqual({
            width: '100%',
            height: '100%',
            minHeight: 240,
            flex: 1,
        });
    });

    it('classifies editable documents and unsupported binaries explicitly', () => {
        expect(classifyFilePreview('src/index.ts')).toBe('text');
        expect(classifyFilePreview('report.pdf')).toBe('pdf');
        expect(classifyFilePreview('report.html')).toBe('html');
        expect(classifyFilePreview('archive.zip')).toBe('unsupported');
        expect(pdfDataUri('AAAA')).toBe('data:application/pdf;base64,AAAA');
    });

    it('sandboxes HTML without blocking Chrome built-in PDF viewer', () => {
        expect(documentPreviewWebSandbox('html')).toBe('');
        expect(documentPreviewWebSandbox('pdf')).toBeUndefined();
    });

    it('wraps HTML in a scriptless, navigation-constrained document', () => {
        const document = safeHtmlPreviewDocument('<html><head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body><script>alert(1)</script><a href="https://evil.test" target="_self">leave</a></body></html>');
        expect(document).toContain('Content-Security-Policy');
        expect(document).toContain("script-src 'none'");
        expect(document).toContain("form-action 'none'");
        expect(document).toContain('<base target="_blank">');
        expect(document).not.toContain('<base href="https://evil.test/">');
        expect(document).not.toContain('http-equiv="refresh"');
        expect(document).not.toContain('<a href=');
        expect(document).not.toContain('target="_self"');
    });
});
