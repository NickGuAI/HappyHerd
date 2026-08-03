import { describe, expect, it } from 'vitest';

import { PRODUCT } from './product';

describe('HappyHerd product metadata', () => {
    it('owns the public product and support destinations', () => {
        expect(PRODUCT.displayName).toBe('HappyHerd');
        expect(PRODUCT.repositoryDisplay).toBe('NickGuAI/HappyHerd');
        expect(PRODUCT.repositoryUrl).toBe('https://github.com/NickGuAI/HappyHerd');
        expect(PRODUCT.issueUrl).toBe('https://github.com/NickGuAI/HappyHerd/issues/new');
    });

    it('does not route product support back to upstream Happy', () => {
        expect(PRODUCT.repositoryUrl).not.toContain('slopus/happy');
        expect(PRODUCT.issueUrl).not.toContain('slopus/happy');
    });
});
