import { describe, expect, it } from 'vitest';
import { normalizeProductLink } from './normalizeProductLink';

describe('retained authentication links', () => {
    /* rename:preserve */
    it.each(['happy', 'happyherd'])('accepts %s without changing key bytes', scheme => {
        expect(normalizeProductLink(`${scheme}:///account?AbC_-123%2F`))
            .toBe('happyherd:///account?AbC_-123%2F');
        expect(normalizeProductLink(`${scheme}://terminal?AbC_-123%2F`))
            .toBe('happyherd://terminal?AbC_-123%2F');
    });
    it('does not rewrite URLs or user content containing the old name', () => {
        for (const input of ['https://example.com/happy:test', 'text happy:test', 'unhappy:test']) {
            expect(normalizeProductLink(input)).toBe(input);
        }
    });
    /* /rename:preserve */
});
