import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Web root viewport sizing', () => {
    it('uses the dynamic viewport height for the root and browser zoom body', () => {
        const themeCss = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');

        expect(themeCss).toMatch(/html, body, #root\s*\{\s*height: 100dvh;/s);
        expect(themeCss).toMatch(
            /html\.happy-app-zoomed body\s*\{[^}]*height: calc\(100vh \/ var\(--happy-app-zoom\)\);\s*height: calc\(100dvh \/ var\(--happy-app-zoom\)\);/s,
        );
    });
});
