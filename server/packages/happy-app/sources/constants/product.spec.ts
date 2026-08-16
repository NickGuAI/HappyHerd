import { describe, expect, it } from 'vitest';

import { PRODUCT } from './product';

describe('HappyHerd product metadata', () => {
    it('keeps product identity independent from repository ownership', () => {
        expect(PRODUCT.displayName).toBe('HappyHerd');
        expect(PRODUCT.repositoryDisplay).toBe('');
        expect(PRODUCT.repositoryUrl).toBe('');
        expect(PRODUCT.issueUrl).toBe('');
    });

    it('does not route product support back to upstream Happy', () => {
        expect(PRODUCT.repositoryUrl).not.toContain('slopus/happy');
        expect(PRODUCT.issueUrl).not.toContain('slopus/happy');
    });
});
