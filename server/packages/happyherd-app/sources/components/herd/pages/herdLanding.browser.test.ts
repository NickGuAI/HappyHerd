import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import en from '@/text/locales/en.json';
import { getLatestTitle } from '@/changelog/parser';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sourcesRoot = resolve(appRoot, 'sources');
const iconFonts = resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts');

/**
 * The landing renders through the Unistyles Babel transform and web runtime the
 * Expo build uses, with the real icon fonts, the brand PNG, the English catalog
 * and the bundled changelog. Only navigation and settings are stubbed.
 */
const PRODUCTION_STYLE_FILES = /components\/herd\/pages\/HerdLanding(Art)?(\.web)?\.tsx$/;

const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        export const Platform = { ...ReactNativeWeb.Platform, OS: 'web', select: (options) => options.web ?? options.default };
    `,
    'fixture-theme': `
        import { lightTheme, darkTheme } from '@/theme';
        export const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
    `,
    'expo-font': `export const isLoaded = () => true; export const loadAsync = async () => {}; export const useFonts = () => [true, null];`,
    'expo-asset': `export const Asset = { fromModule: (module) => ({ uri: typeof module === 'string' ? module : module.uri }) };`,
    'expo-router': `
        const record = (kind) => (path) => { (window.__NAVIGATION__ ??= []).push(kind + ' ' + path); };
        export const useRouter = () => ({ navigate: record('navigate'), push: record('push') });
    `,
    '@/sync/storage': `
        export const useSetting = (key) => key === 'machineWorkspace'
            ? new URLSearchParams(window.location.search).get('workspace') !== 'off'
            : undefined;
    `,
    '@/text': `
        import en from '@/text/locales/en.json';
        export const t = (key) => key.split('.').reduce((value, part) => value?.[part], en) ?? key;
    `,
};

const fixturePlugin: Plugin = {
    name: 'herd-landing-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles') return { path: 'production-styles', namespace: 'fixture-stub' };
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(sourcesRoot, args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.web.tsx`, `${sourcePath}.tsx`, `${sourcePath}.ts`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: args.path === 'production-styles'
                ? `
                    import { theme } from 'fixture-theme';
                    import { StyleSheet, useUnistyles } from ${JSON.stringify(resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/index.js'))};
                    StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } });
                    export { StyleSheet, useUnistyles };
                `
                : virtualModules[args.path],
            loader: 'tsx',
            resolveDir: here,
        }));
        bundle.onLoad({ filter: PRODUCTION_STYLE_FILES }, (args) => {
            // Unistyles disables its component transform under Vitest's NODE_ENV=test.
            const previousNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            let transformed;
            try {
                transformed = transformSync(readFileSync(args.path, 'utf8'), {
                    filename: args.path,
                    configFile: false,
                    babelrc: false,
                    caller: { name: 'metro', platform: 'web', supportsStaticESM: true } as any,
                    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
                    plugins: [['react-native-unistyles/plugin', { root: 'sources' }]],
                });
            } finally {
                process.env.NODE_ENV = previousNodeEnv;
            }
            if (!transformed?.code) throw new Error(`production style transform failed: ${args.path}`);
            return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) };
        });
    },
};

// The desktop main area beside the left panel, as the mock sizes it at 1440 × 900 and 1024 × 768.
const MAIN_AREAS = [
    { name: '1440', width: 1108, height: 848 },
    { name: '1024', width: 732, height: 716 },
] as const;

describe('Signed-in landing in the production style runtime', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import { HerdLanding } from '@/components/herd/pages/HerdLanding';
                    createRoot(document.getElementById('root')).render(React.createElement(HerdLanding));
                `,
                loader: 'tsx',
                resolveDir: here,
            },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            loader: { '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        const themeCss = readFileSync(resolve(sourcesRoot, 'theme.css'), 'utf8');
        const fonts = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold'];
        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://fixture.test');
            const font = url.pathname.match(/^\/fonts\/([A-Za-z-]+)\.ttf$/);
            if (font) {
                const file = fonts.includes(font[1])
                    ? resolve(sourcesRoot, 'assets/fonts', `${font[1]}.ttf`)
                    : resolve(iconFonts, `${font[1]}.ttf`);
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(file));
                return;
            }
            const faces = [
                ...fonts.map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`),
                '@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}',
                '@font-face{font-family:octicons;src:url(/fonts/Octicons.ttf)}',
            ].join('');
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>${faces}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('landing fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 60_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((closed) => server.close(() => closed()));
    });

    async function openLanding(options: { theme: 'light' | 'dark'; width: number; height: number; workspace?: boolean; reducedMotion?: boolean }) {
        const page = await browser.newPage({ viewport: { width: options.width, height: options.height } });
        page.setDefaultTimeout(5_000);
        await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`${origin}/?theme=${options.theme}${options.workspace === false ? '&workspace=off' : ''}`);
        await page.getByTestId('herd-landing').waitFor();
        await page.evaluate(() => document.fonts.ready);
        // On a loaded host the blocks can still be rising here (about 0.55 s), and a box
        // measured mid-slide is off by a rounding step: 45.99997 px for a 46 px button.
        await page.evaluate(() => Promise.all(document.getAnimations()
            .filter((animation) => (animation as CSSAnimation).animationName?.startsWith('herd-rise'))
            .map((animation) => animation.finished.catch(() => undefined))));
        return { page, errors };
    }

    const navigation = (page: Page) => page.evaluate(() => (window as any).__NAVIGATION__ ?? []);

    it.each(['light', 'dark'] as const)('draws the mock landing over its horizon, and every entry opens its page: %s', async (theme) => {
        const { page, errors } = await openLanding({ theme, width: 1108, height: 848 });
        const landing = page.getByTestId('herd-landing');
        const background = theme === 'dark' ? 'rgb(1, 2, 4)' : 'rgb(247, 239, 221)';
        await expect(landing.evaluate((node) => getComputedStyle(node).backgroundColor)).resolves.toBe(background);

        // The brush mark: 88 px, filled through the logo PNG's alpha.
        const mark = page.getByTestId('herd-landing-mark');
        const markBox = (await mark.boundingBox())!;
        expect(markBox).toMatchObject({ width: 88, height: 88 });
        const markStyle = await mark.evaluate((node) => ({ mask: getComputedStyle(node).webkitMaskImage || getComputedStyle(node).maskImage, fill: getComputedStyle(node).backgroundImage }));
        expect(markStyle.mask).toContain('data:image/png');
        expect(markStyle.fill).toContain('linear-gradient');

        await expect(page.getByRole('heading', { name: en.sidebar.sessionsTitle }).isVisible()).resolves.toBe(true);
        await expect(page.getByText(en.uiCopy.startANewSessionOnAnyOfYourConnectedMachines, { exact: true }).isVisible()).resolves.toBe(true);

        // The three starting points in the mock's order, the first one primary, with real glyphs.
        const labels = [en.newSession.title, en.happyHerd.automations.title, en.workspace.title];
        const boxes = [];
        for (const label of labels) boxes.push((await page.getByRole('button', { name: label, exact: true }).boundingBox())!);
        expect(boxes.every((box) => box.height === 46)).toBe(true);
        expect(boxes[0].x).toBeLessThan(boxes[1].x);
        expect(boxes[1].x).toBeLessThan(boxes[2].x);
        const glyphFamilies = await page.getByTestId('herd-landing-new')
            .evaluate((node) => [...node.querySelectorAll('*')].map((child) => getComputedStyle(child).fontFamily));
        expect(glyphFamilies.some((family) => family.includes('octicons'))).toBe(true);
        expect(await page.evaluate(() => document.fonts.check('17px octicons'))).toBe(true);

        const latest = getLatestTitle();
        const whatsNew = page.getByTestId('herd-landing-whats-new');
        await expect(whatsNew.getAttribute('aria-label')).resolves.toBe(`${en.updateBanner.whatsNew}: ${latest}`);
        // The sparkle glyph comes first; the text follows it.
        expect((await whatsNew.innerText()).trim().endsWith(`${en.updateBanner.whatsNew} · ${latest}`)).toBe(true);

        // The horizon's rim rises 160 px above the bottom edge and lets clicks through.
        const rim = page.getByTestId('herd-landing-horizon-rim');
        expect((await rim.boundingBox())!.y).toBe(848 - 160);
        await expect(page.getByTestId('herd-landing-horizon').evaluate((node) => getComputedStyle(node).pointerEvents)).resolves.toBe('none');
        await expect(rim.evaluate((node) => getComputedStyle(node).boxShadow)).resolves.not.toBe('none');

        // The content sits centered above the horizon.
        const title = (await page.getByRole('heading', { name: en.sidebar.sessionsTitle }).boundingBox())!;
        expect(Math.abs(title.x + title.width / 2 - 1108 / 2)).toBeLessThanOrEqual(1);
        expect(markBox.y + markBox.height).toBeLessThan(title.y);

        for (const label of labels) await page.getByRole('button', { name: label, exact: true }).click();
        await whatsNew.click();
        await expect(navigation(page)).resolves.toEqual(['navigate /new', 'push /automations', 'push /workspace', 'push /changelog']);
        expect(errors).toEqual([]);
        await page.close();
    });

    it('keeps the mock\'s vertical rhythm in the 1440 main area', async () => {
        // Measured from the approved mock's main area (1108 × 848) at 1440 × 900.
        const { page, errors } = await openLanding({ theme: 'dark', width: 1108, height: 848 });
        const top = async (locator: ReturnType<Page['getByTestId']>) => (await locator.boundingBox())!;
        const mark = await top(page.getByTestId('herd-landing-mark'));
        const title = await top(page.getByRole('heading', { name: en.sidebar.sessionsTitle }));
        const subtitle = await top(page.getByText(en.uiCopy.startANewSessionOnAnyOfYourConnectedMachines, { exact: true }));
        const button = await top(page.getByTestId('herd-landing-new'));
        const whatsNew = await top(page.getByTestId('herd-landing-whats-new'));
        const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
        near(mark.y, 258);
        near(title.y, 368);
        near(title.height, 41);
        near(subtitle.y, 423);
        near(button.y, 468);
        near(whatsNew.y, 546);
        near(whatsNew.height, 44);
        expect(errors).toEqual([]);
        await page.close();
    });

    it('keeps Workspace behind the machineWorkspace setting, as the left panel does', async () => {
        const { page, errors } = await openLanding({ theme: 'dark', width: 1108, height: 848, workspace: false });
        await page.getByRole('button', { name: en.newSession.title, exact: true }).waitFor();
        await expect(page.getByRole('button', { name: en.happyHerd.automations.title, exact: true }).count()).resolves.toBe(1);
        await expect(page.getByRole('button', { name: en.workspace.title, exact: true }).count()).resolves.toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    });

    it('rises in with the shared motion, and holds still with reduced motion', async () => {
        const moving = await openLanding({ theme: 'dark', width: 1108, height: 848 });
        const classes = await moving.page.getByTestId('herd-landing').evaluate((node) => [...node.children].map((child) => child.className));
        expect(classes.filter((name) => name.includes('herd-rise')).length).toBe(5);
        expect(classes.some((name) => name.includes('herd-d4'))).toBe(true);
        await expect(moving.page.getByTestId('herd-landing-horizon-rim').evaluate((node) => getComputedStyle(node).animationName)).resolves.toBe('herd-fade');
        await moving.page.close();
        const still = await openLanding({ theme: 'dark', width: 1108, height: 848, reducedMotion: true });
        await expect(still.page.getByTestId('herd-landing-horizon-rim').evaluate((node) => getComputedStyle(node).animationName)).resolves.toBe('none');
        await still.page.close();
    });

    it.each(MAIN_AREAS.flatMap((area) => (['light', 'dark'] as const).map((theme) => ({ ...area, theme }))))(
        'fits the $name main area without overflow: $theme', async ({ name, width, height, theme }) => {
            const { page, errors } = await openLanding({ theme, width, height });
            await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
            const whatsNew = (await page.getByTestId('herd-landing-whats-new').boundingBox())!;
            expect(whatsNew.x).toBeGreaterThanOrEqual(0);
            expect(whatsNew.x + whatsNew.width).toBeLessThanOrEqual(width);
            const directory = process.env.HERD_LANDING_EVIDENCE_DIR?.trim();
            if (directory) {
                mkdirSync(directory, { recursive: true });
                // Past the rise and the horizon's 1.2 s fade.
                await page.waitForTimeout(1_400);
                await page.screenshot({ path: resolve(directory, `app-landing-${name}-${theme}.png`) });
            }
            expect(errors).toEqual([]);
            await page.close();
        },
    );
});
