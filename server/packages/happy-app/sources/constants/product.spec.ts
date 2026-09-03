import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT } from './product';

describe('HappyHerd product metadata', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('keeps product identity independent from repository ownership', () => {
        expect(PRODUCT.displayName).toBe('HappyHerd');
        expect(PRODUCT.repositoryDisplay).toBe('');
        expect(PRODUCT.repositoryUrl).toBe('');
        expect(PRODUCT.issueUrl).toBe('');
        expect(PRODUCT.supportUrl).toBe('');
    });

    it('does not route product support back to upstream Happy', () => {
        expect(PRODUCT.repositoryUrl).not.toContain('slopus/happy');
        expect(PRODUCT.issueUrl).not.toContain('slopus/happy');
        expect(PRODUCT.supportUrl).not.toContain('slopus/happy');
    });

    it('reads the support destination from deployment metadata', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPYHERD_SUPPORT_URL', 'https://buymeacoffee.com/nickguy');
        vi.resetModules();
        const { PRODUCT: configuredProduct } = await import('./product');

        expect(configuredProduct.supportUrl).toBe('https://buymeacoffee.com/nickguy');
    });
});
