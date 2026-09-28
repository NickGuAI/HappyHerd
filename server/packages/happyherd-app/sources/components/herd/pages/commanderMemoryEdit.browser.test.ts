import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sourcesRoot = resolve(appRoot, 'sources');
const iconFonts = resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts');

/**
 * The Commanders page's memory sheet with in-place editing, rendered through the
 * Unistyles Babel transform and web runtime the Expo build uses, with the real
 * icon fonts, the English catalog, the real page, sheet, Markdown view and the
 * Workspace's own file editor. Only the machine RPCs, synced storage, routing,
 * the modal system and the Commander avatar are stubbed.
 */
const ROOT = '/home/user/.happyherd/commanders/albert/agentcontext';
const WORKING = `${ROOT}/memory/1-working-memory.md`;
const LONG_TERM = `${ROOT}/memory/2-long-term-memory.md`;

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
    'expo-clipboard': `export const setStringAsync = async () => true;`,
    'expo-image': `
        import React from 'react';
        export const Image = ({ source, style }) => React.createElement('img', { src: typeof source === 'string' ? source : source?.uri, style: Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : style, alt: '' });
    `,
    'react-native/Libraries/Image/resolveAssetSource': `export default (source) => source;`,
    'expo-router': `
        export const useRouter = () => ({ navigate() {}, push() {}, back() {}, replace() {} });
        export const useLocalSearchParams = () => ({});
        export const usePathname = () => '/commanders';
        export const Stack = { Screen: () => null };
    `,
    '@react-navigation/native': `
        export const useNavigation = () => ({ dispatch() {}, addListener: () => () => {} });
        export const usePreventRemove = () => {};
    `,
    '@/modal': `
        export const Modal = {
            alert: (title, message) => { (window.__ALERTS__ ??= []).push({ title, message }); },
            confirm: async (title, message, options) => {
                (window.__CONFIRMS__ ??= []).push({ title, message, confirmText: options?.confirmText });
                return window.__CONFIRM_ANSWER__ ?? false;
            },
            prompt: async () => null,
        };
    `,
    '@/text': `
        import en from '@/text/locales/en.json';
        const lookup = (key) => key.split('.').reduce((value, part) => value?.[part], en);
        export const t = (key, params) => {
            let value = lookup(key);
            if (value && typeof value === 'object' && value.select && params) value = value.select.cases[params[value.select.param] === 1 ? 'one' : 'other'];
            if (typeof value !== 'string') return key;
            return params ? value.replace(/\\{(\\w+)\\}/g, (match, name) => name in params ? String(params[name]) : match) : value;
        };
    `,
    '@/components/CommanderSessionAvatar': `
        import React from 'react';
        import { View } from 'react-native';
        export const CommanderSessionAvatar = ({ size }) => React.createElement(View, { style: { width: size, height: size, borderRadius: size / 2, backgroundColor: '#b86a3c' } });
    `,
    '@/components/homeDockFocus': `export const requestHomeDockFocus = () => false;`,
    '@/hooks/useNewSessionDraft': `export const useNewSessionDraft = { getState: () => ({ selectedMachineId: null, setMachineId() {}, setCommanderId() {}, setPath() {}, setSessionType() {}, setWorktreeKey() {} }) };`,
    '@/sync/storage': `
        const machine = { id: 'studio-mac', active: true, activeAt: Date.now(), metadata: { displayName: 'studio-mac', host: 'studio.local', homeDir: '/home/user', platform: 'darwin' }, daemonState: { status: 'running' } };
        export const useAllMachines = () => [machine];
        export const useAllSessions = () => [];
        export const useMachine = (id) => id === machine.id ? machine : null;
        export const useSession = () => null;
        export const useSetting = () => undefined;
        export const useLocalSetting = () => undefined;
        export const storage = { getState: () => ({ settings: {}, localSettings: {}, sessions: {}, machines: { [machine.id]: machine } }), subscribe: () => () => {} };
    `,
    '@/sync/sync': `export const sync = { applySettings() {}, sendMessage: async () => ({}) };`,
    '@/sync/ops': `
        const files = window.__FILES__ = {
            ${JSON.stringify(WORKING)}: '# Albert — Working Memory\\n\\nCurrent operational state only. Durable doctrine lives in 2-long-term-memory.md.\\n\\n## Active lane\\n\\n- Early-signal detection stays paused.\\n',
            ${JSON.stringify(LONG_TERM)}: '# Albert — Long-Term Memory\\n\\n- Prefer precision over lead time.\\n',
        };
        const encoder = new TextEncoder();
        const toBase64 = (text) => { let binary = ''; for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte); return btoa(binary); };
        const fromBase64 = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
        const hash = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        window.__EXTERNAL_WRITE__ = (path, text) => { files[path] = text; };
        export const machineListCommanders = async () => ({
            globalAgentsPath: null,
            commanders: [{ id: 'albert', name: 'Albert', role: 'Strategy commander', workspace: '/home/user/strategy', commanderPath: '/home/user/.happyherd/commanders/albert/COMMANDER.md', agentContextPath: ${JSON.stringify(ROOT)} }],
        });
        export const machineReadFileWithinRoot = async (machineId, path, rootPath) => {
            (window.__READS__ ??= []).push({ machineId, path, rootPath });
            if (!path.startsWith(rootPath + '/') || !(path in files)) return { success: false, error: 'outside root' };
            return { success: true, content: toBase64(files[path]) };
        };
        export const machineWriteFile = async (machineId, path, content, expectedHash) => {
            const text = fromBase64(content);
            (window.__WRITES__ ??= []).push({ machineId, path, text, expectedHash, currentHash: await hash(files[path] ?? '') });
            if (expectedHash !== await hash(files[path] ?? '')) return { success: false, error: 'File hash mismatch' };
            files[path] = text;
            return { success: true, hash: await hash(text) };
        };
        const unexpected = (name) => async () => { (window.__UNEXPECTED_RPC__ ??= []).push(name); return { success: false, error: name }; };
        export const machineReadFile = unexpected('machineReadFile');
        export const machineDeleteFile = unexpected('machineDeleteFile');
        export const sessionReadFile = unexpected('sessionReadFile');
        export const sessionWriteFile = unexpected('sessionWriteFile');
        export const sessionDeleteFile = unexpected('sessionDeleteFile');
    `,
};

const fixturePlugin: Plugin = {
    name: 'commander-memory-edit-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles') return { path: 'production-styles', namespace: 'fixture-stub' };
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(sourcesRoot, args.path.slice(2));
                const path = [`${sourcePath}.web.tsx`, `${sourcePath}.web.ts`, `${sourcePath}.tsx`, `${sourcePath}.ts`, sourcePath, `${sourcePath}/index.ts`, `${sourcePath}/index.tsx`]
                    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
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
        bundle.onLoad({ filter: /sources\/.*\.tsx$/ }, (args) => {
            // Every app component, as in the Expo build: the plugin also rewrites
            // react-native imports so styles from other components still apply.
            const source = readFileSync(args.path, 'utf8');
            if (!source.includes('react-native')) return null;
            // Unistyles disables its component transform under Vitest's NODE_ENV=test.
            const previousNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            let transformed;
            try {
                transformed = transformSync(source, {
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

const FIXTURE = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SafeAreaProvider } from 'react-native-safe-area-context';
    import CommandersScreen from '@/app/(app)/commanders/index';
    const metrics = { frame: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
    createRoot(document.getElementById('root')).render(
        React.createElement(SafeAreaProvider, { initialMetrics: metrics }, React.createElement(CommandersScreen)),
    );
`;

describe('Commander memory editing in the production style runtime', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: { contents: FIXTURE, loader: 'tsx', resolveDir: here },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            loader: { '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx', '.css': 'empty' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            plugins: [fixturePlugin],
            logLevel: 'error',
        });
        const script = bundle.outputFiles[0].text;
        const themeCss = readFileSync(resolve(sourcesRoot, 'theme.css'), 'utf8');
        const fonts = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular'];
        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://fixture.test');
            const font = url.pathname.match(/^\/fonts\/([A-Za-z-]+)\.ttf$/);
            if (font) {
                const appFont = resolve(sourcesRoot, 'assets/fonts', `${font[1]}.ttf`);
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(existsSync(appFont) ? appFont : resolve(iconFonts, `${font[1]}.ttf`)));
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
        if (!address || typeof address === 'string') throw new Error('memory fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 180_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((closed) => server.close(() => closed()));
    });

    async function open(theme: 'light' | 'dark', width: number, height: number) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.setDefaultTimeout(8_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`${origin}/?theme=${theme}`);
        try {
            await page.getByTestId('commander-memory-line-albert').waitFor();
        } catch (error) {
            throw new Error(`Commanders page did not render: ${errors.join(' | ').slice(0, 1500)} || ${(await page.locator('body').innerText()).slice(0, 400)}`);
        }
        await page.evaluate(() => document.fonts.ready);
        return { page, errors };
    }

    async function openMemory(page: Page, file: string) {
        await page.getByRole('button', { name: `Albert · ${file}`, exact: true }).click();
        const sheet = page.getByTestId('commander-memory-sheet');
        await sheet.getByTestId('commander-memory-content').waitFor();
        return sheet;
    }

    async function startEditing(page: Page) {
        const sheet = page.getByTestId('commander-memory-sheet');
        await sheet.getByTestId('commander-memory-edit').click();
        const editor = sheet.getByTestId('commander-memory-editor').locator('textarea');
        await editor.waitFor();
        return { sheet, editor };
    }

    async function saveEvidence(page: Page, name: string) {
        const directory = process.env.COMMANDER_MEMORY_EVIDENCE_DIR?.trim();
        if (!directory) return;
        mkdirSync(directory, { recursive: true });
        await page.waitForTimeout(450);
        await page.screenshot({ path: resolve(directory, `${name}.png`) });
    }

    it.each([
        ['light', 1440, 900],
        ['dark', 1440, 900],
        ['light', 1024, 768],
        ['light', 390, 844],
        ['dark', 390, 844],
    ] as const)('edits and saves the working memory in its sheet (%s, %i px)', async (theme, width, height) => {
        const { page, errors } = await open(theme, width, height);
        const sheet = await openMemory(page, 'memory/1-working-memory.md');
        await expect(sheet.getByText('Current operational state only.', { exact: false }).count()).resolves.toBeGreaterThan(0);
        await expect(page.locator('.hh-markdown-review-gutter').count()).resolves.toBe(0);
        await saveEvidence(page, `memory-preview-${theme}-${width}`);

        const { editor } = await startEditing(page);
        // The Workspace's editor, in Edit, in this sheet: no Delete, no comments.
        await expect(editor.inputValue()).resolves.toContain('Early-signal detection stays paused.');
        await expect(sheet.getByRole('button', { name: 'Save', exact: true }).count()).resolves.toBe(1);
        await expect(sheet.getByRole('button', { name: 'Delete', exact: true }).count()).resolves.toBe(0);
        await expect(sheet.getByTestId('commander-memory-edit').count()).resolves.toBe(0);
        await expect(page.locator('.hh-markdown-review-gutter, .hh-markdown-review-line').count()).resolves.toBe(0);

        // The sheet's title keeps its line beside or above the editor's controls.
        const title = (await sheet.getByRole('heading', { name: 'Albert', exact: true }).boundingBox())!;
        expect(title.height).toBeLessThanOrEqual(27);
        expect(title.width).toBeGreaterThanOrEqual(40);
        await editor.fill('# Albert — Working Memory\n\nThe Settings lane ships today.\n');
        await expect(sheet.getByText('Unsaved', { exact: true }).count()).resolves.toBe(1);
        await saveEvidence(page, `memory-edit-${theme}-${width}`);
        await sheet.getByRole('button', { name: 'Save', exact: true }).click();
        await sheet.getByText('Saved', { exact: true }).waitFor();

        const writes = await page.evaluate(() => (window as any).__WRITES__);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
            machineId: 'studio-mac',
            path: WORKING,
            text: '# Albert — Working Memory\n\nThe Settings lane ships today.\n',
        });
        // The expected hash is the hash of the bytes the Human started from.
        expect(writes[0].expectedHash).toBe(writes[0].currentHash);
        const reads = await page.evaluate(() => (window as any).__READS__);
        expect(reads.every((read: { rootPath: string }) => read.rootPath === ROOT)).toBe(true);
        await expect(page.getByTestId('commander-memory-line-albert').innerText()).resolves.toBe('“The Settings lane ships today.”');

        // Preview goes back to the rendered memory with the saved text.
        await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
        await sheet.getByTestId('commander-memory-content').waitFor();
        await expect(sheet.getByText('The Settings lane ships today.', { exact: true }).count()).resolves.toBe(1);
        await expect(sheet.getByTestId('commander-memory-editor').count()).resolves.toBe(0);
        await expect(sheet.getByTestId('commander-memory-edit').count()).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__UNEXPECTED_RPC__ ?? [])).resolves.toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('refuses a save over a file that changed since it was opened, and keeps the draft', async () => {
        const { page, errors } = await open('light', 1440, 900);
        await openMemory(page, 'memory/2-long-term-memory.md');
        const { sheet, editor } = await startEditing(page);
        await editor.fill('# Albert — Long-Term Memory\n\n- My draft.\n');
        await page.evaluate((path) => (window as any).__EXTERNAL_WRITE__(path, '# Changed elsewhere\n'), LONG_TERM);
        await sheet.getByRole('button', { name: 'Save', exact: true }).click();

        // The Workspace's conflict view, in this sheet; the file keeps the other writer's bytes.
        await sheet.getByText('This file was modified on the device while you were editing.', { exact: false }).first().waitFor();
        const writes = await page.evaluate(() => (window as any).__WRITES__);
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe(LONG_TERM);
        expect(writes[0].expectedHash).not.toBe(writes[0].currentHash);
        await expect(page.evaluate((path) => (window as any).__FILES__[path], LONG_TERM)).resolves.toBe('# Changed elsewhere\n');
        await expect(page.getByTestId('commander-memory-line-albert').innerText())
            .resolves.toBe('“Current operational state only. Durable doctrine lives in 2-long-term-memory.md.”');
        await saveEvidence(page, 'memory-conflict-light-1440');

        // The draft survives: Overwrite writes it against the file's current bytes.
        // The conflict bar's actions are plain pressables with text labels.
        await sheet.getByText('Overwrite', { exact: true }).click();
        await sheet.getByText('Saved', { exact: true }).waitFor();
        const after = await page.evaluate(() => (window as any).__WRITES__);
        expect(after).toHaveLength(2);
        expect(after[1]).toMatchObject({ path: LONG_TERM, text: '# Albert — Long-Term Memory\n\n- My draft.\n' });
        expect(after[1].expectedHash).toBe(after[1].currentHash);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('asks before closing over unsaved edits, from the close button, Escape and the scrim', async () => {
        const { page, errors } = await open('dark', 1440, 900);
        await openMemory(page, 'memory/1-working-memory.md');
        const { sheet, editor } = await startEditing(page);
        await editor.fill('unsaved thought\n');

        await page.evaluate(() => { (window as any).__CONFIRM_ANSWER__ = false; });
        // The header's close button comes before the editor's own Cancel.
        await sheet.getByRole('button', { name: 'Cancel', exact: true }).first().click();
        await page.keyboard.press('Escape');
        await page.mouse.click(8, 8);
        const confirms = await page.evaluate(() => (window as any).__CONFIRMS__);
        expect(confirms).toHaveLength(3);
        expect(confirms[0]).toMatchObject({ title: 'Discard unsaved changes?', confirmText: 'Discard' });
        await expect(editor.inputValue()).resolves.toBe('unsaved thought\n');
        expect(await page.evaluate(() => (window as any).__WRITES__ ?? [])).toEqual([]);

        await page.evaluate(() => { (window as any).__CONFIRM_ANSWER__ = true; });
        await page.mouse.click(8, 8);
        await sheet.waitFor({ state: 'detached' });
        expect(await page.evaluate(() => (window as any).__WRITES__ ?? [])).toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);
});
