import { describe, expect, it } from 'vitest';
import { isHttpMarkdownLink, normalizeExternalMarkdownLink } from './linkUtils';

describe('isHttpMarkdownLink', () => {
    it('accepts http and https links', () => {
        expect(isHttpMarkdownLink('http://example.com')).toBe(true);
        expect(isHttpMarkdownLink('https://example.com/docs')).toBe(true);
        expect(isHttpMarkdownLink(' HTTPS://example.com/docs ')).toBe(true);
    });

    it('rejects non-http schemes and path-like targets', () => {
        expect(isHttpMarkdownLink('mailto:test@example.com')).toBe(false);
        expect(isHttpMarkdownLink('data:text/plain,hello')).toBe(false);
        expect(isHttpMarkdownLink('/Users/me/project/file.ts')).toBe(false);
        expect(isHttpMarkdownLink('packages/happy-app/index.tsx')).toBe(false);
    });

    it('normalizes scheme-relative web links without claiming local paths', () => {
        expect(normalizeExternalMarkdownLink('//example.com/docs')).toBe('https://example.com/docs');
        expect(normalizeExternalMarkdownLink(' HTTPS://example.com/docs ')).toBe('HTTPS://example.com/docs');
        expect(normalizeExternalMarkdownLink('///workspace/file.ts')).toBeNull();
        expect(normalizeExternalMarkdownLink('/workspace/file.ts')).toBeNull();
        expect(normalizeExternalMarkdownLink('\\\\server\\share\\file.ts')).toBeNull();
    });
});
