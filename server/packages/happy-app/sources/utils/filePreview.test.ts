import { describe, expect, it } from 'vitest';
import {
    classifyFilePreview,
    decodeEditableText,
    documentPreviewWebSandbox,
    encodeEditableText,
    imageDataUri,
    imageMimeType,
    imagePreviewLayout,
    isSvgDocument,
    matchesRichPreviewContent,
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

    it('routes every non-preview filename through content inspection', () => {
        expect(classifyFilePreview('src/index.ts')).toBe('text');
        expect(classifyFilePreview('/repo/.xxenv')).toBe('text');
        expect(classifyFilePreview('/repo/.mcp.json')).toBe('text');
        expect(classifyFilePreview('/repo/NOTICE')).toBe('text');
        expect(classifyFilePreview('/repo/notes.db')).toBe('text');
        expect(classifyFilePreview('/repo/archive.zip')).toBe('text');
        expect(classifyFilePreview('report.pdf')).toBe('pdf');
        expect(classifyFilePreview('report.html')).toBe('html');
        expect(pdfDataUri('AAAA')).toBe('data:application/pdf;base64,AAAA');
    });

    it('accepts valid UTF-8 text and rejects binary or malformed bytes', () => {
        const encoder = new TextEncoder();

        expect(decodeEditableText(encoder.encode('TOKEN=value\n'))).toEqual({
            content: 'TOKEN=value\n',
            hasUtf8Bom: false,
        });
        expect(decodeEditableText(Uint8Array.from([0x50, 0x4b, 0x00, 0x03]))).toBeNull();
        expect(decodeEditableText(Uint8Array.from([0xc3, 0x28]))).toBeNull();
    });

    it('requires matching bytes before using filename-selected rich previews', () => {
        const encoder = new TextEncoder();

        expect(matchesRichPreviewContent('notes.png', encoder.encode('plain text\n'))).toBe(false);
        expect(matchesRichPreviewContent('notes.pdf', encoder.encode('plain text\n'))).toBe(false);
        expect(matchesRichPreviewContent('settings.bmp', encoder.encode('BMachine setting=true\n'))).toBe(false);
        expect(matchesRichPreviewContent('sentinel.gif', encoder.encode('GIF89a is plain text\n'))).toBe(false);
        expect(matchesRichPreviewContent('image.png', Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]))).toBe(true);
        expect(matchesRichPreviewContent('report.pdf', encoder.encode('%PDF-1.7\n'))).toBe(true);
        expect(matchesRichPreviewContent('icon.svg', encoder.encode('<svg viewBox="0 0 1 1"></svg>'))).toBe(true);
        expect(isSvgDocument('ordinary text')).toBe(false);
    });

    it('round-trips UTF-8 BOM files without exposing the marker in the editor', () => {
        const original = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x3d, 0x31, 0x0a]);

        const decoded = decodeEditableText(original);
        expect(decoded).toEqual({ content: 'a=1\n', hasUtf8Bom: true });
        expect(Array.from(encodeEditableText(decoded!.content, decoded!.hasUtf8Bom))).toEqual(Array.from(original));
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
