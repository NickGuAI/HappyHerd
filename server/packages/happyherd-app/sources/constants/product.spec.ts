import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT } from './product';

describe('HappyHerd product metadata', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('uses the canonical HappyHerd repository by default', () => {
        expect(PRODUCT.displayName).toBe('HappyHerd');
        expect(PRODUCT.repositoryDisplay).toBe('NickGuAI/HappyHerd');
        expect(PRODUCT.repositoryUrl).toBe('https://github.com/NickGuAI/HappyHerd');
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

    it('allows public distributions to override the repository destination', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPYHERD_REPOSITORY_DISPLAY', 'example/distribution');
        vi.stubEnv('EXPO_PUBLIC_HAPPYHERD_REPOSITORY_URL', 'https://example.com/distribution');
        vi.resetModules();
        const { PRODUCT: configuredProduct } = await import('./product');

        expect(configuredProduct.repositoryDisplay).toBe('example/distribution');
        expect(configuredProduct.repositoryUrl).toBe('https://example.com/distribution');
    });

    it('uses the canonical repository when deployment metadata is blank', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPYHERD_REPOSITORY_DISPLAY', '   ');
        vi.stubEnv('EXPO_PUBLIC_HAPPYHERD_REPOSITORY_URL', '');
        vi.resetModules();
        const { PRODUCT: configuredProduct } = await import('./product');

        expect(configuredProduct.repositoryDisplay).toBe('NickGuAI/HappyHerd');
        expect(configuredProduct.repositoryUrl).toBe('https://github.com/NickGuAI/HappyHerd');
    });
});
