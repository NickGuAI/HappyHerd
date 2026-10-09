import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PRODUCT } from '../../../constants/product';
import { darkTheme, lightTheme } from '@/theme';

/**
 * UI overhaul side panels and Workspace (Web Desktop 1440×900, the overlay
 * below 1,100 px at 1024×768, and Web Mobile 390×844) in the production
 * style runtime: every app source goes through the same Unistyles Babel
 * transform and web runtime the Expo build uses, with theme.css loaded, so
 * `_web` styles, `_classNames` and the herd motion layer are real. Only data,
 * transport and navigation are synthetic (the side-chat SessionView fixture).
 *
 * Set HAPPYHERD_PANELS_EVIDENCE_DIR to also save review screenshots.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sources = resolve(appRoot, 'sources');
const unistylesRoot = resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module');
const evidenceDir = process.env.HAPPYHERD_PANELS_EVIDENCE_DIR?.trim() || null;

// The side-chat SessionView fixture owns the service boundaries (storage,
// sync, ops, modal, navigation). Reuse it and return the rendering modules to
// production.
function readSideChatFixtureModules(): Record<string, string> {
    const file = resolve(sources, 'components/sideChatHeader.browser.test.ts');
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (declaration.name.getText(ast) !== 'virtualModules' || !declaration.initializer) continue;
            return runInNewContext(`(${declaration.initializer.getText(ast)})`, {
                appRoot,
                here: resolve(sources, 'components'),
                resolve,
                PRODUCT,
                newSessionProjectPath: '/work/project/extensions/browser-tools',
                newSessionRecentPath: (index: number) => `/workspace/products/example-project-${String(index).padStart(2, '0')}`,
            });
        }
    }
    throw new Error('sideChatHeader.browser.test.ts no longer declares virtualModules');
}

function replaceOnce(source: string, search: string, replacement: string, label: string): string {
    if (!source.includes(search)) throw new Error(`Fixture adapter drifted: ${label}`);
    return source.replace(search, replacement);
}

function panelsModules(): Record<string, string> {
    const modules = readSideChatFixtureModules();
    // Production catalogs, icons, file icons and shortcut chords. The chat
    // body keeps the fixture's content host, which carries the workspace-link
    // gestures these tests use.
    for (const key of [
        '@/text', '@expo/vector-icons', 'expo-linear-gradient', '@/keyboard/shortcuts',
        '@/components/FileIcon', 'react-native-svg',
    ]) delete modules[key];
    // Rendering-only helpers the SessionView tree still needs.
    modules['react-native'] = `
        import * as RN from 'react-native-web'; import React from 'react';
        export * from 'react-native-web';
        export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) };
        export const useAnimatedValue = (value) => React.useRef(new RN.Animated.Value(value)).current;
    `;
    modules['production-styles'] = `
        import { lightTheme, darkTheme } from '@/theme';
        import { StyleSheet } from ${JSON.stringify(resolve(unistylesRoot, 'index.js'))};
        const dark = new URLSearchParams(window.location.search).get('theme') === 'dark';
        StyleSheet.configure({
            themes: { light: lightTheme, dark: darkTheme },
            settings: { initialTheme: dark ? 'dark' : 'light' },
        });
        export * from ${JSON.stringify(resolve(unistylesRoot, 'index.js'))};
    `;
    modules['expo-image'] = `import React from 'react'; import { Image as NativeImage } from 'react-native-web';
        export const Image = React.forwardRef(({ contentFit, source, tintColor, ...props }, ref) => React.createElement(NativeImage, {
            ...props, ref, source: typeof source === 'string' ? { uri: source } : source,
            resizeMode: contentFit === 'cover' ? 'cover' : 'contain',
        }));`;
    modules['expo-font'] = `export const isLoaded = () => true; export const isLoading = () => false; export const loadAsync = async () => {}; export const useFonts = () => [true, null]; export const getLoadedFonts = () => [];`;
    modules['expo-localization'] = `export const getLocales = () => [{ languageTag: 'en-US', languageCode: 'en' }];`;
    modules['@/sync/persistence'] = `export const loadSettings = () => ({ settings: { preferredLanguage: 'en' } }); export const storeTempText = () => 'synthetic-temp';`;
    modules['@/realtime/RealtimeSession'] = `export const stopRealtimeSession = async () => {}; export const getCurrentVoiceSessionDurationSeconds = () => 0;`;
    modules['@/hooks/useAttachmentImage'] = `export const useAttachmentImage = () => ({ uri: null, error: null });`;
    modules['@react-native-masked-view/masked-view'] = `import React from 'react'; import { View } from 'react-native'; export default ({ maskElement, style }) => React.createElement(View, { style }, maskElement);`;
    modules['react-native-reanimated'] = modules['react-native-reanimated']
        .replace('export default { ScrollView, Text, View };', 'export default { ScrollView, Text, View, createAnimatedComponent: (Component) => Component };')
        + `export const cancelAnimation = () => {}; export const withSpring = (value) => value; export const useAnimatedRef = () => React.useRef(null);
           export const measure = () => ({ width: 24, height: 24 });
           export const FadeIn = { duration: () => ({}) }; export const FadeOut = { duration: () => ({}) };`;
    modules['@/utils/sessionUtils'] = modules['@/utils/sessionUtils'].replace(
        /export const useSessionStatus = [^\n]+;/,
        `export { useSessionStatus } from '${resolve(sources, 'utils/sessionUtils.ts')}';`,
    );

    // Storage: a session with real changes on a branch, so Changes has rows.
    let storage = modules['@/sync/storage'];
    storage = replaceOnce(storage, 'const changedFiles = (sessionId) => ({', `const changedFiles = (sessionId) => sessionId === 'parent' && fixtureOptions.panelsEvidence ? ({
            stagedFiles: [
                { fileName: 'authHelper.ts', filePath: 'src/utils', fullPath: 'src/utils/authHelper.ts', status: 'modified', isStaged: true, linesAdded: 2, linesRemoved: 1 },
            ],
            unstagedFiles: [
                { fileName: 'authHelper.test.ts', filePath: 'src/utils/__tests__', fullPath: 'src/utils/__tests__/authHelper.test.ts', status: 'added', isStaged: false, linesAdded: 14, linesRemoved: 0 },
                { fileName: 'session.ts', filePath: 'src/auth', fullPath: 'src/auth/session.ts', status: 'modified', isStaged: false, linesAdded: 4, linesRemoved: 1 },
                { fileName: 'playwright.config.ts', filePath: '', fullPath: 'playwright.config.ts', status: 'modified', isStaged: false, linesAdded: 2, linesRemoved: 2 },
                { fileName: 'legacy-token.ts', filePath: 'src/auth', fullPath: 'src/auth/legacy-token.ts', status: 'deleted', isStaged: false, linesAdded: 0, linesRemoved: 9 },
            ],
        }) : ({`, 'changed files');
    storage = replaceOnce(storage, 'export const useSessionGitStatus = () => null;',
        `export const useSessionGitStatus = (sessionId) => fixtureOptions.panelsEvidence && sessionId === 'parent'
            ? { branch: 'fix/auth-timeout', linesAdded: fixtureOptions.linesAdded ?? 22, linesRemoved: fixtureOptions.linesRemoved ?? 13, lastUpdatedAt: 1 }
            : null;`, 'git status');
    storage += `\nexport const useRealtimeMode = () => 'idle';`;
    modules['@/sync/storage'] = storage;
    return modules;
}

const virtualModules = panelsModules();

function webVariant(path: string): string | null {
    for (const candidate of [`${path}.web.tsx`, `${path}.web.ts`, `${path}.web.js`]) {
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

function sourceFile(path: string): string | undefined {
    return [
        `${path}.web.tsx`, `${path}.web.ts`, `${path}.tsx`, `${path}.ts`, `${path}.js`, path,
        `${path}/index.web.tsx`, `${path}/index.tsx`, `${path}/index.ts`, `${path}/index.js`,
    ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

// Every app source renders through the Unistyles Babel transform; virtual
// service stubs keep the fixture's own style shim.
const APP_SOURCE = /\/sources\/.+\.(?:tsx|ts)$/;

const fixturePlugin: Plugin = {
    name: 'panels-browser-fixture',
    setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(unistylesRoot, 'components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles' && args.namespace === 'file' && APP_SOURCE.test(args.importer)) {
                return { path: 'production-styles', namespace: 'fixture-stub' };
            }
            if (args.resolveDir.includes('/@shopify/flash-list/') && args.path.startsWith('.')) {
                const webPath = resolve(args.resolveDir, args.path + '.web.js');
                if (existsSync(webPath)) return { path: webPath };
            }
            if (Object.hasOwn(virtualModules, args.path)) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path === './apiSocket' && args.importer.endsWith('/sync/workspaceLive.ts')) {
                return { path: '@/sync/apiSocket', namespace: 'fixture-stub' };
            }
            if (args.path.startsWith('.') && args.resolveDir.startsWith(sources)) {
                const absolute = resolve(args.resolveDir, args.path);
                const key = '@/' + relative(sources, absolute).replace(/\.(?:tsx?|jsx?)$/, '');
                if (Object.hasOwn(virtualModules, key)) return { path: key, namespace: 'fixture-stub' };
                const web = extname(absolute) ? null : webVariant(absolute);
                if (web) return { path: web };
                const exact = sourceFile(absolute);
                if (exact) return { path: exact };
            }
            if (args.path.startsWith('@/')) {
                const path = sourceFile(resolve(sources, args.path.slice(2)));
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
        builder.onLoad({ filter: APP_SOURCE }, (args) => {
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

type Viewport = { width: number; height: number };
const DESKTOP: Viewport = { width: 1440, height: 900 };
const OVERLAY: Viewport = { width: 1024, height: 768 };
const MOBILE: Viewport = { width: 390, height: 844 };
const THEMES = ['light', 'dark'] as const;

describe('Side panels and Workspace overhaul (Web, production style runtime)', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/panels.browser.fixture.tsx')],
            outfile: resolve(appRoot, 'fixture-output/panels.js'),
            absWorkingDir: appRoot,
            nodePaths: [resolve(appRoot, '../../node_modules')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = Buffer.from(bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.contents);
        const cssFile = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
        const bundleCss = cssFile ? Buffer.from(cssFile.contents).toString('utf8') : '';

        const fonts = new Map<string, Buffer>();
        let fontFaces = '';
        for (const family of ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold']) {
            fonts.set(`/fonts/${family}.ttf`, readFileSync(resolve(sources, 'assets/fonts', `${family}.ttf`)));
            fontFaces += `@font-face{font-family:'${family}';src:url('/fonts/${family}.ttf') format('truetype');font-display:block;}`;
        }
        const iconRoot = resolve(appRoot, '../../node_modules/@expo/vector-icons/build');
        for (const name of ['Ionicons', 'Octicons', 'MaterialCommunityIcons', 'MaterialIcons', 'FontAwesome', 'Feather', 'AntDesign']) {
            const file = resolve(iconRoot, `${name}.js`);
            if (!existsSync(file)) continue;
            const code = readFileSync(file, 'utf8');
            const fontName = code.match(/createIconSet\(glyphMap, ['"]([^'"]+)/)?.[1];
            const fontFile = code.match(/import font from ['"](.+?\.(?:ttf|otf))['"]/)?.[1];
            if (!fontName || !fontFile) continue;
            const route = `/fonts/${basename(fontFile)}`;
            fonts.set(route, readFileSync(resolve(iconRoot, fontFile)));
            fontFaces += `@font-face{font-family:'${fontName}';src:url('${route}') format('truetype');font-display:block;}`;
        }
        const themeCss = readFileSync(resolve(sources, 'theme.css'), 'utf8');
        const serviceWorker = readFileSync(resolve(appRoot, 'public/workspace-live-sw.js'));

        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (url.pathname === '/panels.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.end(script);
                return;
            }
            if (url.pathname === '/workspace-live-sw.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.setHeader('service-worker-allowed', '/');
                response.end(serviceWorker);
                return;
            }
            if (fonts.has(url.pathname)) {
                response.setHeader('content-type', 'font/ttf');
                response.end(fonts.get(url.pathname));
                return;
            }
            if (url.pathname === '/favicon.ico') {
                response.writeHead(204);
                response.end();
                return;
            }
            const theme = url.searchParams.get('theme') === 'dark' ? darkTheme : lightTheme;
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
                + `<style>${fontFaces}${themeCss}${bundleCss}html,body,#root{margin:0;height:100%;background:${theme.colors.surface};color:${theme.colors.text};font-family:SpaceGrotesk-Regular}#root{display:flex;flex-direction:column}</style>`
                + `</head><body><main id="root"></main><script>globalThis.global=globalThis;</script><script src="/panels.js"></script></body></html>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('panels fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
        if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    }, 180_000);

    afterAll(async () => {
        await browser?.close();
        await new Promise<void>((done) => server ? server.close(() => done()) : done());
    });

    async function open(viewport: Viewport, theme: 'light' | 'dark', options: Record<string, unknown> = {}) {
        const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: theme });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        await page.addInitScript((fixtureOptions) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = fixtureOptions;
        }, { panelsEvidence: true, ...options });
        await page.goto(`${origin}/?theme=${theme}`);
        await page.getByTestId('foreground-session').waitFor({ state: 'visible' });
        await page.locator('textarea').first().waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        return { page, errors, foreground: page.getByTestId('foreground-session') };
    }

    async function settle(page: Page) {
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        await page.waitForTimeout(500);
    }

    async function evidence(page: Page, name: string) {
        if (!evidenceDir) return;
        await settle(page);
        await page.screenshot({ path: resolve(evidenceDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
    }

    async function drag(page: Page, box: { x: number; y: number; width: number; height: number }, dx: number) {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx / 2, y + 10, { steps: 4 });
        await page.mouse.move(x + dx, y + 20, { steps: 4 });
        await page.mouse.up();
    }

    it.each(THEMES)('docks the right panel with pill tabs, a restyled grip and side chats on Web Desktop (%s)', async (theme) => {
        const { page, errors, foreground } = await open(DESKTOP, theme);

        // Empty panel: the picker cards rise in, each with its shortcut.
        const changesCard = foreground.getByText('Changes', { exact: true });
        await changesCard.waitFor({ state: 'visible' });
        await expect(foreground.getByText('Files this session changed', { exact: true }).isVisible()).resolves.toBe(true);
        await expect(foreground.getByText('Open a parallel chat forked from this session', { exact: true }).isVisible()).resolves.toBe(true);
        const card = changesCard.locator('xpath=ancestor::*[contains(@class, "herd-rise-sm")][1]');
        await expect(card.count()).resolves.toBe(1);
        await evidence(page, `desktop-${theme}-1-picker`);

        // Side chats: the panel pill carries its count; one pill per child below.
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        const sideChatsTab = foreground.getByRole('tab', { name: /Side chats/ });
        await sideChatsTab.waitFor({ state: 'visible' });
        await expect(sideChatsTab.getAttribute('aria-selected')).resolves.toBe('true');
        await expect(sideChatsTab.innerText()).resolves.toMatch(/Side chats\s*2/);
        const oldest = foreground.getByRole('tab', { name: /Oldest child/ });
        await expect(oldest.getAttribute('aria-selected')).resolves.toBe('false');
        await oldest.click();
        await expect.poll(() => oldest.getAttribute('aria-selected')).toBe('true');
        await expect(foreground.getByRole('button', { name: 'Open full screen', exact: true }).isVisible()).resolves.toBe(true);
        await expect(foreground.getByRole('button', { name: 'New side chat', exact: true }).isVisible()).resolves.toBe(true);
        await evidence(page, `desktop-${theme}-2-side-chats`);

        // The grip turns molten under the pointer and the panel widens on drag.
        const divider = foreground.getByRole('slider', { name: 'Drag to resize the side panel' });
        const grip = divider.getByTestId('herd-panel-grip');
        const idle = await grip.evaluate((element) => getComputedStyle(element).backgroundColor);
        await divider.hover();
        await expect.poll(() => grip.evaluate((element) => getComputedStyle(element).height)).toBe('80px');
        const hot = await grip.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(hot).not.toBe(idle);
        const panelHost = foreground.getByTestId('desktop-right-panel-host');
        const before = (await panelHost.boundingBox())!.width;
        await drag(page, (await divider.boundingBox())!, -160);
        await expect.poll(async () => (await panelHost.boundingBox())!.width).toBeGreaterThan(before + 150);
        await evidence(page, `desktop-${theme}-3-resized`);

        // Changes: rows with per-file counts under the branch summary.
        await foreground.getByRole('button', { name: 'Add panel', exact: true }).click();
        await foreground.getByRole('menuitem', { name: 'Changes', exact: true }).click();
        const changesTab = foreground.getByRole('tab', { name: /Changes/ });
        await expect.poll(() => changesTab.getAttribute('aria-selected')).toBe('true');
        await expect(changesTab.innerText()).resolves.toMatch(/Changes\s*\+22\s*−13/);
        await expect(foreground.getByText('fix/auth-timeout', { exact: true }).isVisible()).resolves.toBe(true);
        await expect(foreground.getByText('1 staged • 4 unstaged', { exact: true }).isVisible()).resolves.toBe(true);
        const testRow = foreground.getByText('authHelper.test.ts', { exact: true });
        await expect(testRow.isVisible()).resolves.toBe(true);
        // Directories fold with a smooth height; the row reports its state.
        const folder = foreground.getByRole('button', { name: /__tests__/ });
        await expect(folder.getAttribute('aria-expanded')).resolves.toBe('true');
        await evidence(page, `desktop-${theme}-4-changes`);
        // HerdCollapse keeps the rows mounted and folds them to zero height.
        const hiddenAncestor = testRow.locator('xpath=ancestor::*[@aria-hidden="true"]');
        await folder.click();
        await expect.poll(() => folder.getAttribute('aria-expanded')).toBe('false');
        await expect.poll(() => hiddenAncestor.count()).toBe(1);
        await expect.poll(() => hiddenAncestor.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(1);
        await folder.click();
        await expect.poll(() => hiddenAncestor.count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it('keeps keyboard focus on controls that are visible', async () => {
        const { page, errors, foreground } = await open(DESKTOP, 'light');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        const oldest = foreground.getByRole('tab', { name: /Oldest child/ });
        await oldest.waitFor({ state: 'visible' });
        await expect(oldest.getAttribute('aria-selected')).resolves.toBe('false');
        // Tab from an inactive tab reaches its close button, which shows.
        await oldest.focus();
        await page.keyboard.press('Tab');
        const focusedClose = await page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            return element ? { label: element.getAttribute('aria-label'), opacity: Number(getComputedStyle(element).opacity) } : null;
        });
        expect(focusedClose?.label).toBe('Close side chat');
        await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.activeElement as HTMLElement).opacity))).toBe(1);

        // A collapsed Changes folder keeps its rows out of the tab order.
        await foreground.getByRole('button', { name: 'Add panel', exact: true }).click();
        await foreground.getByRole('menuitem', { name: 'Changes', exact: true }).click();
        const folder = foreground.getByRole('button', { name: /__tests__/ });
        await folder.click();
        await expect.poll(() => folder.getAttribute('aria-expanded')).toBe('false');
        await folder.focus();
        await page.keyboard.press('Tab');
        await expect(page.evaluate(() => Boolean(document.activeElement?.closest('[aria-hidden="true"]')))).resolves.toBe(false);
        expect(errors).toEqual([]);
        await page.close();
    }, 40_000);

    it('gives Escape to the sheet ahead of Back and to its menu first, and keeps a hidden panel quiet', async () => {
        // Stand-in for the app's global navigation, which is registered first
        // and treats an unhandled Escape keydown as Back.
        const { page, errors, foreground } = await open(OVERLAY, 'light');
        await page.evaluate(() => window.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            (window as any).__BACK__ = ((window as any).__BACK__ ?? 0) + 1;
            event.preventDefault();
        }));
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        await scrim.waitFor({ state: 'visible' });
        await blur();
        await page.keyboard.press('Escape');
        await scrim.waitFor({ state: 'detached' });
        await expect(page.evaluate(() => (window as any).__BACK__ ?? 0)).resolves.toBe(0);

        // A menu inside the sheet closes before the sheet.
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        await scrim.waitFor({ state: 'visible' });
        await foreground.getByRole('button', { name: 'Add panel', exact: true }).click();
        const menuItem = foreground.getByRole('menuitem', { name: 'Changes', exact: true });
        await menuItem.waitFor({ state: 'visible' });
        await blur();
        await page.keyboard.press('Escape');
        await expect.poll(() => menuItem.count()).toBe(0);
        await expect(scrim.isVisible()).resolves.toBe(true);
        await page.keyboard.press('Escape');
        await scrim.waitFor({ state: 'detached' });

        // With the sheet hidden, its menu is gone and its shortcuts stay off.
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        await scrim.waitFor({ state: 'visible' });
        await foreground.getByRole('button', { name: 'Add panel', exact: true }).click();
        await menuItem.waitFor({ state: 'visible' });
        const scrimBox = (await scrim.boundingBox())!;
        await page.mouse.click(scrimBox.x + 20, scrimBox.y + scrimBox.height / 2);
        await scrim.waitFor({ state: 'detached' });
        await page.keyboard.press('Control+Alt+KeyS');
        await page.waitForTimeout(300);
        await expect(page.evaluate(() => (window as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).resolves.toBe(0);
        await expect(page.evaluate(() => (window as any).__BACK__ ?? 0)).resolves.toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it.each(THEMES)('keeps the Workspace beside the chat with tabs, a file bar, comments and a draggable divider (%s)', async (theme) => {
        const { page, errors, foreground } = await open(DESKTOP, theme);
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.waitFor({ state: 'visible' });
        const tab = workspace.getByRole('tab', { name: 'Open file tab main-notes.md' });
        await expect(tab.getAttribute('aria-selected')).resolves.toBe('true');
        const fileBar = workspace.getByTestId('desktop-file-workspace-file-bar');
        await expect(fileBar.innerText()).resolves.toContain('main-notes.md');
        await expect(workspace.getByRole('button', { name: 'Preview', exact: true }).getAttribute('aria-pressed')).resolves.toBe('true');
        await expect(workspace.getByRole('button', { name: 'Download', exact: true }).isVisible()).resolves.toBe(true);
        await evidence(page, `desktop-${theme}-5-workspace`);

        // The divider's grip, then a drag to widen the Workspace.
        const divider = foreground.getByTestId('desktop-file-workspace-divider');
        const host = foreground.getByTestId('desktop-file-workspace-host');
        const before = (await host.boundingBox())!.width;
        await divider.hover();
        await expect.poll(() => divider.getByTestId('herd-panel-grip').evaluate((element) => getComputedStyle(element).height)).toBe('80px');
        await drag(page, (await divider.boundingBox())!, -180);
        await expect.poll(async () => (await host.boundingBox())!.width).toBeGreaterThan(before + 170);
        await evidence(page, `desktop-${theme}-6-workspace-resized`);

        // Edit shows the save bar with an unsaved state.
        await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
        const editor = workspace.locator('textarea.code-editor-textarea');
        await editor.waitFor({ state: 'visible' });
        await editor.fill('# Main notes\n\nA new unsaved paragraph for review.\n');
        await expect(workspace.getByText('Unsaved', { exact: true }).isVisible()).resolves.toBe(true);
        await evidence(page, `desktop-${theme}-7-workspace-edit`);

        // Back to Preview: a line comment pinned, the review bar docked.
        await workspace.getByRole('button', { name: 'Preview', exact: true }).click();
        const heading = workspace.locator('h1[data-source-line="1"]');
        await heading.waitFor({ state: 'visible' });
        await heading.hover();
        await heading.getByRole('button', { name: 'Comment on line 1', exact: true }).click();
        const thread = workspace.getByTestId('inline-comment-thread:line:1');
        await thread.getByPlaceholder('Write a comment…').fill('Tighten this heading for the release note.');
        await thread.getByRole('button', { name: 'Pin comment', exact: true }).click();
        await workspace.getByTestId('inline-comment-review-bar').waitFor({ state: 'visible' });
        await expect(workspace.getByRole('button', { name: 'Send 1 comments', exact: true }).isVisible()).resolves.toBe(true);
        await evidence(page, `desktop-${theme}-8-comments`);
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it.each(THEMES)('frames the localhost live page and arms Start commenting (%s)', async (theme) => {
        const url = 'http://localhost:8766/validation-map.html';
        const { page, errors, foreground } = await open(DESKTOP, theme, { localhostLinks: true, localhostUrl: url });
        await foreground.getByRole('link', { name: 'Hosted page parent', exact: true }).click();
        const panel = foreground.getByTestId(`desktop-file-panel:${url}`);
        const live = panel.frameLocator('iframe').getByRole('button', { name: 'Live from machine-1' });
        await live.waitFor({ timeout: 15_000 });
        const fileBar = foreground.getByTestId('desktop-file-workspace-file-bar');
        await expect(fileBar.innerText()).resolves.toContain(url);
        await expect(panel.getByTestId('localhost-live-stage').count()).resolves.toBe(1);
        await evidence(page, `desktop-${theme}-9-live`);

        await fileBar.getByRole('button', { name: 'Start commenting', exact: true }).click();
        await fileBar.getByRole('button', { name: 'Stop commenting', exact: true }).waitFor();
        await page.waitForTimeout(150);
        await live.hover();
        await page.waitForTimeout(200);
        await evidence(page, `desktop-${theme}-10-live-commenting`);
        await live.click();
        await panel.getByPlaceholder('Write a comment…').waitFor({ timeout: 10_000 });
        await evidence(page, `desktop-${theme}-11-live-comment`);
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it.each(THEMES)('slides the right panel and the Workspace over the chat below 1100 px (%s)', async (theme) => {
        const { page, errors, foreground } = await open(OVERLAY, theme);
        const composer = foreground.locator('textarea').first();
        await composer.fill('Main draft kept under the sheet');
        await composer.evaluate((element) => { element.dataset.overlayComposer = 'main'; });
        await expect(foreground.getByTestId('desktop-panel-overlay-scrim').count()).resolves.toBe(0);

        // Side chats slide in over a scrim.
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        await scrim.waitFor({ state: 'visible' });
        const sheet = foreground.getByTestId('desktop-right-panel-host');
        await expect(sheet.evaluate((element) => element.className)).resolves.toContain('herd-slide-right');
        await expect(scrim.evaluate((element) => element.className)).resolves.toContain('herd-fade');
        await evidence(page, `overlay-${theme}-1-side-chats`);
        await foreground.getByRole('button', { name: 'Hide panel', exact: true }).click();
        await scrim.waitFor({ state: 'detached' });

        // The Workspace uses the same sheet; an unsaved draft survives closing it.
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
        await scrim.waitFor({ state: 'visible' });
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
        const editor = workspace.locator('textarea.code-editor-textarea');
        await editor.waitFor({ state: 'visible' });
        await editor.fill('# Overlay draft\n\nStill here after the sheet closes.\n');
        await editor.evaluate((element) => { element.dataset.overlayEditor = 'mounted'; });
        await evidence(page, `overlay-${theme}-2-workspace`);
        const scrimBox = (await scrim.boundingBox())!;
        await page.mouse.click(scrimBox.x + 20, scrimBox.y + scrimBox.height / 2);
        await scrim.waitFor({ state: 'detached' });
        await evidence(page, `overlay-${theme}-3-closed`);
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
        await scrim.waitFor({ state: 'visible' });
        await expect(editor.getAttribute('data-overlay-editor')).resolves.toBe('mounted');
        await expect(editor.inputValue()).resolves.toBe('# Overlay draft\n\nStill here after the sheet closes.\n');
        await expect(foreground.locator('textarea[data-overlay-composer="main"]').inputValue()).resolves.toBe('Main draft kept under the sheet');
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it.each([390, 320])('keeps Add and Hide inside the phone sheet at %i px, the pills scrolling sideways', async (width) => {
        // Two side chats and a Changes pill counting +100 −100 are wider than the phone's sheet.
        const { page, errors, foreground } = await open({ width, height: 844 }, 'light', { linesAdded: 100, linesRemoved: 100 });
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        const sheet = foreground.getByTestId('desktop-right-panel-host');
        await sheet.waitFor({ state: 'visible' });
        await sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const sheetBox = (await sheet.boundingBox())!;
        await expect(sheet.getByText('+100', { exact: true }).count()).resolves.toBe(1);
        for (const control of [foreground.getByRole('button', { name: 'Add panel', exact: true }), foreground.getByTestId('files-sidebar-hide')]) {
            const box = (await control.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(sheetBox.x);
            expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(Math.round(sheetBox.x + sheetBox.width));
        }
        // The pills give way instead, scrolling sideways within their strip.
        const strip = await foreground.getByTestId('files-sidebar-tabs').evaluate((element) => {
            const scroller = [element, ...element.querySelectorAll('*')].find((node) => getComputedStyle(node).overflowX === 'auto' || getComputedStyle(node).overflowX === 'scroll')!;
            return { scroll: scroller.scrollWidth, client: scroller.clientWidth };
        });
        expect(strip.scroll).toBeGreaterThan(strip.client);
        await evidence(page, `mobile-light-sheet-header-${width}`);
        // Hide still closes the sheet.
        await foreground.getByTestId('files-sidebar-hide').click();
        await foreground.getByTestId('desktop-panel-overlay-scrim').waitFor({ state: 'detached' });
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it.each(THEMES)('slides Side chats and the Workspace in as a sheet on Web Mobile, over a strip of the chat (%s)', async (theme) => {
        const { page, errors, foreground } = await open(MOBILE, theme);
        const composer = foreground.locator('textarea').first();
        await composer.fill('Main draft kept under the sheet');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        await scrim.waitFor({ state: 'visible' });
        await expect(foreground.getByRole('tab', { name: /Newest child/ }).isVisible()).resolves.toBe(true);
        // Phones get the desktop sheet, leaving the mock's 16 px strip of the chat beside it.
        const sheet = foreground.getByTestId('desktop-right-panel-host');
        await sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const sheetBox = (await sheet.boundingBox())!;
        expect(Math.round(sheetBox.x)).toBe(16);
        expect(Math.round(sheetBox.width)).toBe(MOBILE.width - 16);
        await evidence(page, `mobile-${theme}-1-side-chats`);
        // The strip closes it.
        await page.mouse.click(8, MOBILE.height / 2);
        await scrim.waitFor({ state: 'detached' });
        await expect.poll(() => foreground.getByRole('tab', { name: /Newest child/ }).isVisible()).toBe(false);

        // The Workspace uses the same sheet, and the chat's draft survives underneath.
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
        await scrim.waitFor({ state: 'visible' });
        const host = foreground.getByTestId('desktop-file-workspace-host');
        await expect(host.getByText('main-notes.md', { exact: true }).first().isVisible()).resolves.toBe(true);
        await host.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const hostBox = (await host.boundingBox())!;
        expect(Math.round(hostBox.x)).toBe(16);
        expect(Math.round(hostBox.width)).toBe(MOBILE.width - 16);
        await evidence(page, `mobile-${theme}-2-workspace`);
        await page.keyboard.press('Escape');
        await scrim.waitFor({ state: 'detached' });
        await expect(foreground.locator('textarea').first().inputValue()).resolves.toBe('Main draft kept under the sheet');
        await evidence(page, `mobile-${theme}-3-closed`);
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);
});
