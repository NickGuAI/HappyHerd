import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import de from '@/text/locales/de.json';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const virtualModules: Record<string, string> = {
    'react-native': `
        export * from 'react-native-web';
        import { Platform as WebPlatform } from 'react-native-web';
        export const Platform = { ...WebPlatform, OS: globalThis.__PLATFORM__, select: values => values[globalThis.__PLATFORM__] ?? values.default };
    `,
    'react-native-unistyles': `
        import { StyleSheet as NativeStyleSheet } from 'react-native-web';
        import { lightTheme, darkTheme } from '@/theme';
        const theme = globalThis.__THEME__ === 'dark' ? darkTheme : lightTheme;
        export const StyleSheet = { ...NativeStyleSheet, create: factory => typeof factory === 'function' ? factory(theme, {}) : factory };
        export const useUnistyles = () => ({ theme });
        export const withUnistyles = Component => Component;
    `,
    '@expo/vector-icons': `import React from 'react'; export const Ionicons = ({ name, size, color }) => React.createElement('span', { 'data-icon': name, style: { width: size, height: size, color } });`,
    'expo-image': `import React from 'react'; import { Image as NativeImage } from 'react-native-web'; export const Image = ({contentFit, ...props}) => React.createElement(NativeImage, {...props, resizeMode:contentFit});`,
    'expo-router': `export const useRouter = () => ({navigate: path => { globalThis.__NAVIGATION__ = path; }});`,
    '@/sync/storage': `export const useAllMachines = () => globalThis.__MACHINES__; export const useSettingMutable = () => [true, () => { globalThis.__ARCHIVED__ = true; }];`,
    '@/sync/machineChoices': `export const collectMachineChoices = machines => machines;`,
    '@/hooks/useVisibleSessionListViewData': `export const useVisibleSessionListViewData = () => []; export const useHasArchivedSessions = () => globalThis.__HAS_ARCHIVED__;`,
    '@/components/SessionsList': `export const SessionsList = () => null;`,
    '@/hooks/useConnectTerminal': `export const useConnectTerminal = () => ({ connectTerminal: () => {globalThis.__CAMERA__ = true;}, connectWithUrl: url => {globalThis.__CONNECTED_URL__ = url;}, isLoading: false });`,
    '@/hooks/useOfflineMachineTroubleshooting': `export const useOfflineMachineTroubleshooting = () => () => {globalThis.__TROUBLESHOOT__ = true;};`,
    '@/modal': `export const Modal = { prompt: async () => '  happy://terminal/review  ' };`,
    '@/text': `import de from '@/text/locales/de.json'; export const t = key => key.split('.').reduce((value, part) => value?.[part], de) ?? key;`,
};
const fixturePlugin: Plugin = {
    name: 'empty-main-production-component',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, args => {
            const normalized = args.path.startsWith('.') && args.resolveDir.startsWith(resolve(appRoot, 'sources'))
                ? `@/${relative(resolve(appRoot, 'sources'), resolve(args.resolveDir, args.path))}` : args.path;
            if (normalized in virtualModules) return { path: normalized, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const source = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [source, `${source}.ts`, `${source}.tsx`].find(existsSync);
                if (!path) throw new Error(`Missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, args => ({ contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

// Render the production wrapper/component, controls, palette, fonts and German catalog.
// Platform.OS selects the native onboarding branch; DOM scrolling proves layout
// and visible gestures only, not native hardware, safe areas or camera access.
describe('EmptyMainScreen onboarding reachability', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SessionsListWrapper} from '@/components/SessionsListWrapper'; createRoot(document.getElementById('root')).render(<SessionsListWrapper topContentInset={globalThis.__DOCK__ ? 80 : 0} bottomContentInset={108} />);`,
                loader: 'tsx', resolveDir: appRoot,
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.NODE_ENV': '"test"' },
            loader: { '.webp': 'dataurl' }, plugins: [fixturePlugin],
        });
        const fontCss = ['SpaceGrotesk-Regular', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular'].map(font => `@font-face{font-family:'${font}';src:url(data:font/ttf;base64,${readFileSync(resolve(appRoot, 'sources/assets/fonts', font + '.ttf')).toString('base64')})}`).join('');
        server = createServer((request, response) => {
            const params = new URL(request.url ?? '/', 'http://fixture').searchParams;
            const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
            const platform = params.get('platform') ?? 'ios';
            const state = params.get('state');
            const dock = params.has('dock');
            const hasArchived = params.has('archive');
            const machines = state ? [{ id: 'test-machine', name: 'Laptop', online: state === 'online' }] : [];
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${fontCss}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;background:${theme === 'dark' ? '#010204' : '#F7EFDD'}}</style><main id="root"></main>${dock ? '<div data-testid="native-dock-overlay" style="position:absolute;bottom:0;left:0;right:0;height:98px;z-index:30;background:#151B28"></div>' : ''}<script>globalThis.__THEME__=${JSON.stringify(theme)};globalThis.__PLATFORM__=${JSON.stringify(platform)};globalThis.__MACHINES__=${JSON.stringify(machines)};globalThis.__DOCK__=${dock};globalThis.__HAS_ARCHIVED__=${hasArchived};globalThis.global=globalThis;${bundle.outputFiles[0].text}</script>`);
        });
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('EmptyMainScreen fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>(closed => server.close(() => closed()));
    });

    it.each(['light', 'dark'])('scrolls German native onboarding to camera, manual URL and archive actions on a short screen: %s', async theme => {
        const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/?theme=${theme}&archive=1`);
        const scroll = page.getByTestId('empty-main-onboarding');
        await scroll.waitFor();
        await page.evaluate(() => document.fonts.ready);
        const initial = await scroll.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight }));
        expect(initial.total).toBeGreaterThan(initial.height);
        expect(initial.top).toBe(0);
        const manual = page.getByRole('button', { name: de.connect.enterUrlManually, exact: true });
        expect((await manual.boundingBox())!.y).toBeGreaterThan(400);
        await scroll.hover();
        await page.mouse.wheel(0, 1000);
        await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await manual.click();
        expect(await page.evaluate(() => (globalThis as any).__CONNECTED_URL__)).toBe('happy://terminal/review');
        await page.getByRole('button', { name: de.components.emptyMainScreen.openCamera, exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__CAMERA__)).toBe(true);
        await page.getByRole('button', { name: de.sidebar.showArchived, exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__ARCHIVED__)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        const commandColor = await page.getByText(de.uiCopy.npmIGHappy, {exact:true}).evaluate(element => getComputedStyle(element).color);
        expect(commandColor).toBe(theme === 'dark' ? 'rgb(240, 220, 176)' : 'rgb(110, 82, 34)');
        const evidence = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (evidence) { mkdirSync(evidence, {recursive:true}); await page.screenshot({path:resolve(evidence, `empty-main-de-${theme}-360x400.png`)}); }
        expect(errors).toEqual([]);
        await page.close();
    });

    it.each(['light', 'dark'])('keeps the final manual action above the native bottom dock using the wrapper inset: %s', async theme => {
        const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
        await page.goto(`${origin}/?theme=${theme}&dock=1`);
        const scroll = page.getByTestId('empty-main-onboarding');
        await scroll.waitFor();
        await page.evaluate(() => document.fonts.ready);
        // The real MainView dock occupies 8px top +56px shell +34px safe area.
        // Its existing108px content inset must reach this actual wrapper branch.
        await page.mouse.move(180, 180);
        await page.mouse.wheel(0, 1000);
        await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        const manual = page.getByRole('button', {name:de.connect.enterUrlManually, exact:true});
        const unobscured = await manual.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const dock = document.querySelector('[data-testid="native-dock-overlay"]')!.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { bottom: rect.bottom, dockTop: dock.top, hit: hit === element || element.contains(hit) };
        });
        expect(unobscured.bottom).toBeLessThanOrEqual(unobscured.dockTop);
        expect(unobscured.hit).toBe(true);
        await manual.click({timeout:2000});
        expect(await page.evaluate(() => (globalThis as any).__CONNECTED_URL__)).toBe('happy://terminal/review');
        const evidence = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (evidence) { mkdirSync(evidence, {recursive:true}); await page.screenshot({path:resolve(evidence, `empty-main-dock-de-${theme}-360x400.png`)}); }
        await page.close();
    });

    it.each(['online', 'offline'])('retains connected-machine state and existing primary action: %s', async state => {
        const page = await browser.newPage({ viewport: { width: 390, height: 568 } });
        await page.goto(`${origin}/?state=${state}`);
        expect(await page.getByTestId('empty-main-onboarding').count()).toBe(0);
        const label = state === 'online' ? de.newSession.title : de.components.emptyMainScreen.troubleshoot;
        await page.getByRole('button', {name:label, exact:true}).click();
        expect(await page.evaluate(which => which === 'online' ? (globalThis as any).__NAVIGATION__ : (globalThis as any).__TROUBLESHOOT__, state)).toBe(state === 'online' ? '/new' : true);
        await page.close();
    });

    it('preserves the Web no-machine branch without native camera actions', async () => {
        const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
        await page.goto(`${origin}/?platform=web&archive=1`);
        await page.getByTestId('empty-main-onboarding').waitFor();
        expect(await page.getByRole('button', {name:de.components.emptyMainScreen.openCamera, exact:true}).count()).toBe(0);
        expect(await page.getByRole('button', {name:de.connect.enterUrlManually, exact:true}).count()).toBe(0);
        await page.getByRole('button', {name:de.sidebar.showArchived, exact:true}).click();
        expect(await page.evaluate(() => (globalThis as any).__ARCHIVED__)).toBe(true);
        await page.close();
    });
});
