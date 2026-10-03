import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildFixture } = require('./__testdata__/sessionRouterFixture.cjs');
describe('Installed ExpoRoot session route lifetime and browser history', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    beforeAll(async () => {
        const result = await buildFixture();
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><main id="root"></main><script>globalThis.global=globalThis;' + result.outputFiles[0].text + '</script>');
        });
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture failed to bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true });
    }, 30000);
    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>(closed => server.close(() => closed()));
    }, 20000);
    it.each([1440, 390].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme }))))(
        'keeps one real Expo session route and browser Back returns home at $width in $theme',
        async ({ width, theme }) => {
            const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme as 'light' | 'dark' });
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin);
            await page.getByTestId('router-home').waitFor();
            const homeHistory = await page.evaluate(() => history.length);
            for (const id of ['A', 'B', 'C']) {
                // Hidden stack home is still mounted; choose the currently visible route.
                await page.getByRole('button', { name: 'Open ' + id, exact: true }).click();
                await page.waitForURL('**/session/' + id);
                await expect.poll(() => page.getByTestId('session-route').getAttribute('data-session-id'), { timeout: 5000 }).toBe(id);
                expect(await page.getByTestId('session-route').count()).toBe(1);
                expect(await page.evaluate(() => (window as any).__mountedSessionRoutes)).toBe(1);
                const sessionRoutes = await page.evaluate(() => {
                    const walk = (state: any): any[] => (state?.routes ?? []).flatMap((route: any) => [route, ...walk(route.state)]);
                    return walk((window as any).__readRealRouterState()).filter(route => route.name === 'session/[id]').map(route => ({ key: route.key, id: route.params?.id }));
                });
                expect(sessionRoutes).toHaveLength(1);
                expect(sessionRoutes[0].id).toBe(id);
                expect(await page.evaluate(() => history.length)).toBe(homeHistory + 1);
            }
            await page.goBack(); // Real browser popstate, never router.back() or fake recorder.
            await page.waitForURL(origin + '/');
            await page.getByTestId('router-home').waitFor({ state: 'visible' });
            await expect.poll(() => page.getByTestId('session-route').count(), { timeout: 5000 }).toBe(0);
            expect(await page.evaluate(() => (window as any).__mountedSessionRoutes)).toBe(0);
            expect(errors).toEqual([]);
            await page.close();
        }, 30000,
    );

});
