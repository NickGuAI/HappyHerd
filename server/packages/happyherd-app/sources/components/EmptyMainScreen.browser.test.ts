import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import de from '@/text/locales/de.json';
import en from '@/text/locales/en.json';
import cn from '@/text/locales/cn.json';

const catalogs = { en, cn, de };
const installCommand = 'curl -fsSL https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/install.sh | sh';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const virtualModules: Record<string, string> = {
    'react-native': `
        export * from 'react-native-web';
        import { Platform as WebPlatform } from 'react-native-web';
        // iOS Alert.prompt is an OS boundary: a real browser prompt accepts test input.
        export const Alert = {prompt: (title, message, buttons, type, value) => { const answer = window.prompt(title + '\\n' + message, value); const button = buttons.find(button => answer === null ? button.style === 'cancel' : button.style !== 'cancel'); button.onPress(answer); }};
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
    'expo-router': `export const usePathname = () => '/'; export const useRouter = () => ({navigate: path => { globalThis.__NAVIGATION__ = path; }, push: path => { globalThis.__NAVIGATION__ = path; }});`,
    '@/sync/storage': `export const useRealtimeStatus = () => 'disconnected'; export const useSetting = () => true; export const useSocketStatus = () => ({status:'connected'}); export const useAllMachines = () => globalThis.__MACHINES__; export const useSettingMutable = () => [true, () => { globalThis.__ARCHIVED__ = true; }];`,
    '@/sync/serverConfig': `export const getServerUrl = () => 'https://review.example.test';`,
    '@/sync/machineChoices': `export const collectMachineChoices = machines => machines;`,
    '@/hooks/useVisibleSessionListViewData': `export const useVisibleSessionListViewData = () => []; export const useHasArchivedSessions = () => globalThis.__HAS_ARCHIVED__;`,
    '@/components/SessionsList': `export const SessionsList = () => null;`,
    '@/hooks/useConnectTerminal': `export const useConnectTerminal = () => ({ connectTerminal: () => {globalThis.__CAMERA__ = true;}, connectWithUrl: url => {globalThis.__CONNECTED_URL__ = url;}, isLoading: false });`,
    '@/hooks/useOfflineMachineTroubleshooting': `export const useOfflineMachineTroubleshooting = () => () => {globalThis.__TROUBLESHOOT__ = true;};`,
    'react-native-safe-area-context': `import React from 'react'; export const SafeAreaInsetsContext = React.createContext({top:0,bottom:0,left:0,right:0}); export const useSafeAreaInsets = () => React.useContext(SafeAreaInsetsContext);`,
    '@/components/herd/shell/windowInsets': `export const useWindowSafeAreaInsets = () => ({top:0,bottom:0,left:0,right:0});`,
    '@/components/herd/mobile/useHerdPhone': `export const HERD_PHONE_FLOAT_MARGIN = 8; export const useHerdPhoneLayout = () => true;`,
    '@/components/herd/shell/phoneShell': `export const useHerdPhoneShell = selector => selector({searchOpen:false,searchQuery:'',closeDrawer:()=>{}});`,
    '@/hooks/useNewSessionDraft': `export const useNewSessionDraft = {getState:()=>({attachments:[]})};`,
    '@/hooks/useStartSessionFromDraft': `export const useStartSessionFromDraft = () => ({isStarting:false,phase:null,startSession:async()=>false,cancelStart:()=>{}});`,
    '@/components/ShortcutHints': `export const useShortcutHints = () => ({visible:false});`,
    '@/components/MainView': `export const MainView = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null;`,
    '@/components/StatusDot': `export const StatusDot = () => null;`,
    '@/components/herd/shell/HerdShellIcon': `import React from 'react'; export const HerdShellIcon = ({name}) => <span data-icon={name}/>;`,
    '@/components/HomeDock': `import React from 'react'; export const MOBILE_HOME_DOCK_CONTENT_INSET = 108; export const HomeDock = () => <div data-testid="native-dock-overlay" style={{height:98,background:'#151B28'}}/>;`,
    '@/modal/components/CustomModal': `export const CustomModal = () => null;`,
    '@/components/AnimatedOverlay': `export const AnimatedBlurBackdrop = () => null;`,
    '@/components/MobileGlass': `import React from 'react'; import {View} from 'react-native-web'; export const MobileGlassSurface = ({children,style}) => <View style={style}>{children}</View>;`,
    '@/text': `import en from '@/text/locales/en.json'; import cn from '@/text/locales/cn.json'; import de from '@/text/locales/de.json'; const catalog = {en,cn,de}[globalThis.__LOCALE__ ?? 'de']; export const t = (key, values = {}) => { const value = key.split('.').reduce((value, part) => value?.[part], catalog) ?? key; return Object.entries(values).reduce((text,[name,replacement]) => text.replaceAll('{'+name+'}', replacement), value); };`,
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
                const path = [source, `${source}.ts`, `${source}.tsx`, `${source}/index.ts`, `${source}/index.tsx`].find(path => existsSync(path) && statSync(path).isFile());
                if (!path) throw new Error(`Missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, args => ({ contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

async function submitTerminalUrl(page: Page, catalog: typeof en) {
    if (await page.evaluate(() => (globalThis as any).__PLATFORM__) === 'ios') {
        await expect.poll(() => page.evaluate(() => (globalThis as any).__CONNECTED_URL__)).toBe('happyherd://terminal/review');
        return;
    }
    const input = page.getByPlaceholder(catalog.uiCopy.happyherdTerminal, { exact: true });
    await input.waitFor();
    // The 16px anti-zoom contract applies to Web Mobile; Android keeps its native 14dp default.
    const platform = await page.evaluate(() => (globalThis as any).__PLATFORM__);
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(platform === 'web' ? 16 : 14);
    await input.fill('  happyherd://terminal/review  ');
    await page.getByRole('button', { name: catalog.common.authenticate, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__CONNECTED_URL__)).toBe('happyherd://terminal/review');
    expect(await input.count()).toBe(0);
}

// Render production PhoneHome → SidebarView → SessionsListWrapper → EmptyMainScreen,
// plus ModalProvider and its real prompt. Only session/account/network boundaries,
// native visual adapters and the HomeDock footprint are stubbed. iOS and Android
// select the shared native-phone branch. iOS Alert.prompt is adapted to a browser
// prompt; Web/Android use the production custom prompt. These are DOM layout and
// gesture proofs, not physical native, camera or authenticated pairing evidence.
describe('EmptyMainScreen onboarding reachability', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {PhoneHome} from '@/components/herd/mobile/PhoneHome'; import {ModalProvider} from '@/modal'; createRoot(document.getElementById('root')).render(<ModalProvider><PhoneHome /></ModalProvider>);`,
                loader: 'tsx', resolveDir: appRoot,
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.NODE_ENV': '"test"' },
            loader: { '.webp': 'dataurl' }, plugins: [fixturePlugin],
        });
        const fontCss = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular'].map(font => `@font-face{font-family:'${font}';src:url(data:font/ttf;base64,${readFileSync(resolve(appRoot, 'sources/assets/fonts', font + '.ttf')).toString('base64')})}`).join('');
        server = createServer((request, response) => {
            const params = new URL(request.url ?? '/', 'http://fixture').searchParams;
            const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
            const platform = params.get('platform') ?? 'ios';
            const locale = params.get('locale') ?? 'de';
            const state = params.get('state');
            const hasArchived = params.has('archive');
            const machines = state ? [{ id: 'test-machine', name: 'Laptop', online: state === 'online' }] : [];
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${fontCss}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;background:${theme === 'dark' ? '#010204' : '#F7EFDD'}}</style><main id="root"></main><script>globalThis.__LOCALE__=${JSON.stringify(locale)};globalThis.__THEME__=${JSON.stringify(theme)};globalThis.__PLATFORM__=${JSON.stringify(platform)};globalThis.__MACHINES__=${JSON.stringify(machines)};globalThis.__HAS_ARCHIVED__=${hasArchived};globalThis.global=globalThis;${bundle.outputFiles[0].text}</script>`);
        });
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('EmptyMainScreen fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true });
    }, 30_000);

    afterAll(async () => {
        // All pages have finished: drain fixture sockets as well as the browser.
        // Neither shutdown should wait for the other to release its connection.
        const serverClosed = server ? new Promise<void>((closed, reject) => {
            server.close(error => error ? reject(error) : closed());
            server.closeAllConnections();
        }) : Promise.resolve();
        await Promise.all([serverClosed, browser?.close()]);
    });

    it.each(['light', 'dark'])('scrolls German native onboarding to camera, manual URL and archive actions on a short screen: %s', async theme => {
        const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept('  happyherd://terminal/review  '));
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
        await submitTerminalUrl(page, de);
        await page.getByRole('button', { name: de.components.emptyMainScreen.openCamera, exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__CAMERA__)).toBe(true);
        await scroll.getByRole('button', { name: de.sidebar.showArchived, exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__ARCHIVED__)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        const commandColor = await page.getByText(installCommand, {exact:true}).evaluate(element => getComputedStyle(element).color);
        expect(commandColor).toBe(theme === 'dark' ? 'rgb(240, 220, 176)' : 'rgb(110, 82, 34)');
        const evidence = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (evidence) { mkdirSync(evidence, {recursive:true}); await page.screenshot({path:resolve(evidence, `empty-main-de-${theme}-360x400.png`)}); }
        expect(errors).toEqual([]);
        await page.close();
    });

    it.each(['light', 'dark'])('keeps the manual action above the native bottom dock in PhoneHome: %s', async theme => {
        const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
        page.on('dialog', dialog => dialog.accept('  happyherd://terminal/review  '));
        await page.goto(`${origin}/?theme=${theme}`);
        const scroll = page.getByTestId('empty-main-onboarding');
        await scroll.waitFor();
        await page.evaluate(() => document.fonts.ready);
        // PhoneHome owns the overlay; its 108px wrapper inset clears the dock footprint.
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
        await submitTerminalUrl(page, de);
        const evidence = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (evidence) { mkdirSync(evidence, {recursive:true}); await page.screenshot({path:resolve(evidence, `empty-main-dock-de-${theme}-360x400.png`)}); }
        await page.close();
    });

    it.each(['online', 'offline'])('retains connected-machine state and existing primary action: %s', async state => {
        const page = await browser.newPage({ viewport: { width: 390, height: 568 } });
        await page.goto(`${origin}/?state=${state}`);
        expect(await page.getByTestId('empty-main-onboarding').count()).toBe(0);
        const label = state === 'online' ? de.newSession.title : de.components.emptyMainScreen.troubleshoot;
        await page.getByRole('button', {name:label, exact:true}).last().click();
        expect(await page.evaluate(which => which === 'online' ? (globalThis as any).__NAVIGATION__ : (globalThis as any).__TROUBLESHOOT__, state)).toBe(state === 'online' ? '/new' : true);
        await page.close();
    });

    it('preserves the Web no-machine branch without native camera actions', async () => {
        const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
        await page.goto(`${origin}/?platform=web&archive=1`);
        await page.getByTestId('empty-main-onboarding').waitFor();
        expect(await page.getByRole('button', {name:de.components.emptyMainScreen.openCamera, exact:true}).count()).toBe(0);
        await page.getByRole('button', {name:de.connect.enterUrlManually, exact:true}).click();
        await submitTerminalUrl(page, de);
        await page.getByTestId('empty-main-onboarding').getByRole('button', {name:de.sidebar.showArchived, exact:true}).click();
        expect(await page.evaluate(() => (globalThis as any).__ARCHIVED__)).toBe(true);
        await page.close();
    });
    it.each(Object.entries(catalogs).flatMap(([locale, catalog]) =>
        ['web', 'ios', 'android'].flatMap(platform => ['light', 'dark'].flatMap(theme => [320, 360, 390].map(width => ({ locale, catalog, platform, theme, width })))),
    ))('shows exact install, authorization and discovery steps in the phone host: $locale $platform $theme $width', async ({locale, catalog, platform, theme, width}) => {
        expect(readFileSync(resolve(appRoot, '../../../README.md'), 'utf8')).toContain(`\n${installCommand}\n`);
        const page = await browser.newPage({ viewport: { width, height: 400 } });
        const evidence = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (evidence) mkdirSync(evidence, {recursive:true});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/?platform=${platform}&locale=${locale}&theme=${theme}`);
        await page.getByTestId('herd-sidebar-docked').waitFor();
        const scroll = page.getByTestId('empty-main-onboarding');
        await scroll.waitFor();
        await page.evaluate(() => document.fonts.ready);
        for (const command of [installCommand, 'happyherd auth login', 'happyherd daemon start']) {
            const element = scroll.getByText(command, {exact:true});
            await element.scrollIntoViewIfNeeded();
            expect(await element.textContent()).toBe(command);
            expect(await element.evaluate(node => getComputedStyle(node).userSelect)).not.toBe('none');
            const rect = (await element.boundingBox())!;
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(width);
            if (evidence && command === installCommand) await page.screenshot({path:resolve(evidence, `first-run-${locale}-${platform}-${theme}-${width}x400-install.png`)});
        }
        expect(await scroll.getByText(catalog.components.emptyMainScreen.serverSelection.replace('{serverUrl}', 'https://review.example.test'), {exact:true}).count()).toBe(1);
        expect(await scroll.getByText(catalog.components.emptyMainScreen.authorizeDescription, {exact:true}).count()).toBe(1);
        const discovery = scroll.getByText(catalog.components.emptyMainScreen.discoveryDescription.replace('{newSession}', catalog.newSession.title), {exact:true});
        await discovery.scrollIntoViewIfNeeded();
        expect(await discovery.isVisible()).toBe(true);
        const camera = scroll.getByRole('button', {name:catalog.components.emptyMainScreen.openCamera, exact:true});
        expect(await camera.count()).toBe(platform === 'web' ? 0 : 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(await scroll.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(width);
        const manual = scroll.getByRole('button', {name:catalog.connect.enterUrlManually, exact:true});
        await manual.scrollIntoViewIfNeeded();
        // Reach the visible action by keyboard from the page's natural tab order.
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        let reached = false;
        for (let tab = 0; tab < 20; tab++) {
            await page.keyboard.press('Tab');
            reached = await manual.evaluate(element => element === document.activeElement);
            if (reached) break;
        }
        expect(reached).toBe(true);
        if (platform === 'ios') page.once('dialog', dialog => dialog.dismiss());
        await page.keyboard.press('Enter');
        if (platform !== 'ios') {
            const input = page.getByPlaceholder(catalog.uiCopy.happyherdTerminal, {exact:true});
            await input.waitFor();
            // RN Modal and BaseModal animate independently; capture only their visible final state.
            await expect.poll(() => input.evaluate(element => {
                for (let node: Element | null = element; node; node = node.parentElement) {
                    if (Number(getComputedStyle(node).opacity) !== 1) return false;
                }
                return true;
            })).toBe(true);
            if (evidence) await page.screenshot({path:resolve(evidence, `first-run-${locale}-${platform}-${theme}-${width}x400-prompt.png`)});
            await input.fill('happyherd://terminal/cancelled');
            await page.getByRole('button', {name:catalog.common.cancel, exact:true}).click();
        }
        expect(await page.evaluate(() => (globalThis as any).__CONNECTED_URL__)).toBeUndefined();
        if (platform === 'ios') page.once('dialog', dialog => dialog.accept('  happyherd://terminal/review  '));
        await manual.click();
        await submitTerminalUrl(page, catalog);
        if (evidence) await page.screenshot({path:resolve(evidence, `first-run-${locale}-${platform}-${theme}-${width}x400-action.png`)});
        await discovery.scrollIntoViewIfNeeded();
        await scroll.hover();
        await page.mouse.wheel(0, 1000);
        await expect.poll(() => scroll.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
        if (platform !== 'web') {
            const finalText = (await discovery.boundingBox())!;
            const dock = (await page.getByTestId('native-dock-overlay').boundingBox())!;
            expect(finalText.y + finalText.height).toBeLessThanOrEqual(dock.y);
        }
        if (evidence) {
            await page.screenshot({path:resolve(evidence, `first-run-${locale}-${platform}-${theme}-${width}x400-daemon.png`)});
            await scroll.evaluate(element => { element.scrollTop = 0; });
            await page.screenshot({path:resolve(evidence, `first-run-${locale}-${platform}-${theme}-${width}x400-start.png`)});
        }
        expect(errors).toEqual([]);
        await page.close();
    });

});
