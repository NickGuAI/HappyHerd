import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

// Keep the production viewer, file content, Markdown, inline threads, footer
// composer, and feedback serialization. Only RPC and platform state are mocked.
const virtualModules: Record<string, string> = {
    'react-native-unistyles': `
        const colors = new Proxy({
            text: '#111', textSecondary: '#666', divider: '#ddd', surface: '#fff',
            surfaceHigh: '#f3f3f3', input: { background: '#eee' },
            button: { primary: { background: '#111', tint: '#fff' } },
        }, { get: (target, key) => target[key] ?? '#111' });
        const theme = { dark: false, colors };
        export const StyleSheet = {
            hairlineWidth: 1,
            create: (factory) => typeof factory === 'function' ? factory(theme) : factory,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name, 'aria-hidden': true }, '+');
        Icon.glyphMap = {};
        export const Ionicons = Icon;
        export const Octicons = Icon;
    `,
    'expo-image': `
        import React from 'react';
        export const Image = ({ source }) => React.createElement('img', { src: source?.uri, alt: '' });
    `,
    'expo-linear-gradient': `
        import React from 'react';
        import { View } from 'react-native';
        export const LinearGradient = ({ children, style }) => React.createElement(View, { style }, children);
    `,
    'react-native-gesture-handler': `export { ScrollView } from 'react-native';`,
    'react-native-keyboard-controller': `export const useKeyboardState = () => ({ isVisible: false, height: 0 });`,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'expo-router': `export const useRouter = () => ({ push() {} });`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/utils/responsive': `export const useHeaderHeight = () => 64; export const getDeviceType = () => window.innerWidth < 500 ? 'phone' : 'desktop';`,
    '@/constants/Typography': `export const Typography = { default: () => ({}), mono: () => ({}) };`,
    '@/components/FileIcon': `
        import React from 'react';
        export const FileIcon = () => React.createElement('span', { 'data-file-icon': true }, '+');
    `,
    '@/sync/storage': `
        import React from 'react';
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        let machine = { id: 'linked-machine', active: !new URLSearchParams(window.location.search).has('offline'), activeAt: Date.now(), metadata: { host: 'fixture', platform: 'linux' } };
        const session = { id: 'linked-session', metadata: { path: '/workspace', machineId: machine.id } };
        let machines = [machine];
        window.__MACHINE_ACTIVE__ = machine.active;
        window.__SET_MACHINE_ACTIVE__ = (active) => {
            window.__MACHINE_ACTIVE__ = active;
            machine = { ...machine, active };
            machines = [machine];
            listeners.forEach((listener) => listener());
        };
        export const useAllMachines = () => React.useSyncExternalStore(subscribe, () => machines);
        export const useMachine = () => React.useSyncExternalStore(subscribe, () => machine);
        export const useIsDataReady = () => true;
        export const useSession = () => session;
    `,
    '@/sync/ops': `
        const file = { type: 'file', name: 'review.md', path: '/workspace/review.md' };
        window.__FILE_READ_CALLS__ = [];
        export const machineGetDirectoryTree = async (_machineId, path) => ({
            success: true,
            tree: path === file.path ? file : { type: 'directory', name: 'workspace', path: '/workspace', children: [file] },
        });
        export const machineReadFile = async (machineId, path) => {
            const failed = window.__FAIL_FILE_READ__ === true || window.__MACHINE_ACTIVE__ === false;
            window.__FILE_READ_CALLS__.push({ machineId, path, failed });
            return failed
                ? { success: false, error: 'EIO: temporary read failure' }
                : { success: true, content: btoa('# Review fixture\\n\\nA paragraph to review.\\n\\nAnother paragraph.\\n') };
        };
        export const machineWriteFile = async () => ({ success: true });
        export const machineReadFileWithinRoot = async () => ({ success: false });
        export const machineDeleteFile = async () => ({ success: true });
        export const sessionReadFile = async () => { throw new Error('Unexpected session file read'); };
        export const sessionWriteFile = async () => { throw new Error('Unexpected session file write'); };
        export const sessionDeleteFile = async () => { throw new Error('Unexpected session file delete'); };
    `,
    '@/sync/sync': `
        window.__FEEDBACK_CALLS__ = [];
        export const sync = {
            sendMessage: async (sessionId, text, options) => {
                window.__FEEDBACK_CALLS__.push({ sessionId, text, options });
                return { localId: 'accepted-feedback' };
            },
        };
    `,
    '@/modal': `export const Modal = { alert() {}, confirm: async () => true };`,
    '@/-session/workspaceLinkNavigation': `export const useWorkspaceLinkPress = () => null;`,
    '@/hooks/useImagePicker': `
        export const useImagePicker = () => ({
            selectedImages: [], pickImages: async () => {}, removeImage() {}, clearImages() {}, addImages() {},
        });
    `,
    '@/hooks/useVoiceInputAvailability': `export const useVoiceInputAvailability = () => ({ available: false });`,
    '@/hooks/useVoiceDictation': `export const useVoiceDictation = () => ({ phase: 'idle', error: null, canRetry: false, toggle() {}, retry() {} });`,
    '@/text': `export const t = (key, params) => params?.line ? key + ':' + params.line : key;`,
};

const fixturePlugin: Plugin = {
    name: 'workspace-link-viewer-browser-fixture',
    setup(buildContext) {
        buildContext.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/') || args.path.startsWith('.')) {
                const sourcePath = args.path.startsWith('@/')
                    ? resolve(appRoot, 'sources', args.path.slice(2))
                    : resolve(args.resolveDir, args.path);
                const path = [`${sourcePath}.web.tsx`, `${sourcePath}.web.ts`, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (path) return { path };
            }
            return null;
        });
        buildContext.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot,
        }));
    },
};

describe('WorkspaceLinkViewer browser feedback retention', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/WorkspaceLinkViewer.browser.fixture.tsx')],
            bundle: true, write: false, outdir: 'out', format: 'esm', splitting: true,
            platform: 'browser', jsx: 'automatic', alias: { 'react-native': 'react-native-web' },
            loader: { '.png': 'dataurl', '.ttf': 'dataurl' }, plugins: [fixturePlugin],
        });
        const files = new Map(bundle.outputFiles.map((file) => [`/${basename(file.path)}`, file]));
        const stylesheet = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
        server = createServer((request, response) => {
            const output = files.get(new URL(request.url ?? '/', 'http://fixture').pathname);
            response.setHeader('content-type', output ? 'text/javascript' : 'text/html; charset=utf-8');
            response.end(output?.contents ?? '<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;font-family:sans-serif}*{box-sizing:border-box}' + stylesheet + '</style><main id="root"></main><script type="module" src="/WorkspaceLinkViewer.browser.fixture.js"></script>');
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Browser fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((closed) => server.close(() => closed()));
    });

    it.each([
        { surface: 'Web Desktop', viewport: { width: 1440, height: 900 }, failure: 'poll' },
        { surface: 'Web Mobile', viewport: { width: 390, height: 844 }, failure: 'poll' },
        { surface: 'Web Desktop', viewport: { width: 1440, height: 900 }, failure: 'connection' },
        { surface: 'Web Mobile', viewport: { width: 390, height: 844 }, failure: 'connection' },
    ])('retains comments on $surface through $failure failure and recovery', async ({ viewport, failure }) => {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        await page.clock.install();
        await page.goto(origin);
        await page.getByRole('button', { name: 'files.commentOnLine:3', exact: true }).click();
        const draft = page.getByPlaceholder('files.commentPlaceholder');
        await draft.fill('Pinned before the transient failure');
        await page.getByRole('button', { name: 'files.pinComment', exact: true }).click();
        await page.getByRole('button', { name: 'files.commentOnLine:5', exact: true }).click();
        await draft.fill('Unfinished comment');
        const originalDraft = await draft.elementHandle();
        const fileControls = page.getByRole('button', { name: 'uiCopy.preview', exact: true }).locator('..');
        await page.evaluate((kind) => {
            if (kind === 'connection') (window as any).__SET_MACHINE_ACTIVE__(false);
            else (window as any).__FAIL_FILE_READ__ = true;
        }, failure);
        await page.clock.fastForward(5_100);
        await expect.poll(() => page.evaluate(() => (window as any).__FILE_READ_CALLS__.some((call: any) => call.failed))).toBe(true);
        expect(await draft.count()).toBe(1);
        expect(await draft.inputValue()).toBe('Unfinished comment');
        expect(await page.getByText('Pinned before the transient failure', { exact: true }).count()).toBe(1);
        expect(await originalDraft!.evaluate((element) => element.isConnected)).toBe(true);
        expect(await originalDraft!.evaluate((element) => element === document.activeElement)).toBe(true);
        if (failure === 'connection') {
            expect(await fileControls.getByRole('button', { name: 'files.editFile', exact: true }).count()).toBe(0);
        }

        await page.evaluate((kind) => {
            if (kind === 'connection') (window as any).__SET_MACHINE_ACTIVE__(true);
            else (window as any).__FAIL_FILE_READ__ = false;
        }, failure);
        await page.clock.fastForward(5_100);
        await expect.poll(() => page.evaluate(() => (window as any).__FILE_READ_CALLS__.at(-1).failed)).toBe(false);
        expect(await fileControls.getByRole('button', { name: 'files.editFile', exact: true }).count()).toBe(1);
        await draft.press('End');
        await draft.pressSequentially(' after recovery');
        expect(await draft.inputValue()).toBe('Unfinished comment after recovery');
        await page.getByRole('button', { name: 'files.pinComment', exact: true }).click();
        await page.getByRole('button', { name: 'files.sendComments', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__FEEDBACK_CALLS__.length)).toBe(1);
        const sent = await page.evaluate(() => (window as any).__FEEDBACK_CALLS__[0]);
        expect(sent.sessionId).toBe('linked-session');
        expect(sent.text).toContain('Line: 3\nFeedback:\nPinned before the transient failure');
        expect(sent.text).toContain('Line: 5\nFeedback:\nUnfinished comment after recovery');
        expect(errors).toEqual([]);
        await context.close();
    }, 30_000);

    it('shows the initial offline state and opens the same reference after reconnecting', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${origin}/?offline=1`);
        await page.getByText('workspace.offlineTitle', { exact: true }).waitFor();
        expect(await page.evaluate(() => (window as any).__FILE_READ_CALLS__)).toEqual([]);
        await page.evaluate(() => { (window as any).__SET_MACHINE_ACTIVE__(true); });
        await page.getByRole('button', { name: 'files.commentOnLine:3', exact: true }).waitFor();
        expect(await page.getByText('workspace.offlineTitle', { exact: true }).count()).toBe(0);
        await context.close();
    });

    it('keeps an initial read failure recoverable through the visible Retry action', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(() => { (window as any).__FAIL_FILE_READ__ = true; });
        await page.goto(origin);
        await expect.poll(() => page.locator('body').innerText()).toContain('workspace.linkReadErrorTitle');
        expect(await page.locator('.hh-markdown-root').count()).toBe(0);
        await page.evaluate(() => { (window as any).__FAIL_FILE_READ__ = false; });
        await page.getByRole('button', { name: 'common.retry', exact: true }).click({ timeout: 1_000 });
        await page.getByRole('button', { name: 'files.commentOnLine:3', exact: true }).waitFor();
        expect(await page.getByText('workspace.linkReadErrorTitle', { exact: true }).count()).toBe(0);
        await context.close();
    });

    it('sends general feedback with the fallback link line and column', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(origin);
        await page.getByPlaceholder('review.feedbackPrompt').fill('Feedback at the linked position');
        await page.getByRole('button', { name: 'happyHerd.composer.send', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__FEEDBACK_CALLS__.length)).toBe(1);
        const sent = await page.evaluate(() => (window as any).__FEEDBACK_CALLS__[0]);
        expect(sent.sessionId).toBe('linked-session');
        expect(sent.text).toContain('Machine ID: linked-machine');
        expect(sent.text).toContain('Absolute path: /workspace/review.md\nLine: 3\nColumn: 7');
        await context.close();
    });
});
