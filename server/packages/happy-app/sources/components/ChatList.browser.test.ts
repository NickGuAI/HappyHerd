import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const virtualModules: Record<string, string> = {
    'react-native': `export * from 'react-native-web'; export const TurboModuleRegistry = { get: () => null };`,
    'react-native-unistyles': `
        const colors = {
            text: '#111', textSecondary: '#666', textLink: '#06c', divider: '#ddd', surface: '#fff',
            surfaceHigh: '#eee', surfaceHighest: '#eee', success: '#080', warning: '#a70', input: { text: '#111' },
            shadow: { color: '#000', opacity: 0.1 }, header: { tint: '#111' },
            groupped: { background: '#fff' },
            box: { error: { background: '#fee', border: '#c00', text: '#900' }, warning: { background: '#ffd', text: '#770' } },
            terminal: { background: '#111', prompt: '#0f0', command: '#fff', stdout: '#ddd', stderr: '#f80', error: '#f88', emptyOutput: '#bbb' },
        };
        const theme = { dark: false, colors };
        export const StyleSheet = { create: factory => typeof factory === 'function' ? factory(theme) : factory };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name });
        export const Ionicons = Icon; export const Octicons = Icon;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0 });`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    'expo-router': `export const useRouter = () => ({ push: value => { window.__route = value; } });`,
    '@/utils/responsive': `export const useHeaderHeight = () => 0; export const getDeviceType = () => 'phone';`,
    '@/utils/harnessCatalog': `export const getHarnessName = () => 'Agent';`,
    '@/sync/rig': `export const usesControlledSessionUi = () => false;`,
    '@/sync/controlHandoff': `export const resolveControlMode = () => 'agent';`,
    '@/sync/sync': `export const sync = { loadOlderMessages: async () => {}, sendMessage: async () => {} };`,
    '@/sync/storage': `
        import React from 'react';
        const listeners = new Set();
        const user = (index) => ({ kind: 'user-text', id: 'user-'+index, localId: null, createdAt: index, text: 'Prompt '+index });
        const tool = (id, title) => ({ kind: 'tool-call', id, localId: null, createdAt: 2, children: [], tool: { name: 'read_file', title, state: 'completed', input: {}, result: 'done', createdAt: 2, startedAt: 2, completedAt: 3 } });
        const agent = (id, text, createdAt) => ({ kind: 'agent-text', id, localId: null, createdAt, text });
        export const session = { id: 'browser-session', active: true, thinking: false, metadata: { flavor: 'codex' }, agentState: {} };
        let snapshot = new URLSearchParams(location.search).has('focus')
            ? { messages: Array.from({ length: 150 }, (_, index) => user(149-index)), hasMoreOlder: false, isLoadingOlder: false }
            : { messages: [agent('final', 'Completed response', 5), tool('last-tool', 'Inspect second file'), agent('progress', 'Checking the source', 3), tool('first-tool', 'Inspect first file'), user(0)], hasMoreOlder: false, isLoadingOlder: false };
        window.__prepend = () => { snapshot = { ...snapshot, messages: [user(150), ...snapshot.messages] }; listeners.forEach(fn => fn()); };
        export const useSession = () => session;
        export const useSessionMessages = () => React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
        export const useSetting = key => key === 'groupToolCalls' || key === 'compactToolCalls';
        export const useLocalSetting = () => false;
    `,
    '@/text': `
        export const t = (key, params = {}) => ({
            'toolGroup.hide': 'Hide', 'toolGroup.workedFor': 'Worked for '+params.duration,
            'uiCopy.jumpToLatest': 'Jump to latest', 'uiCopy.newMessagesJumpToLatest': params.count+' new messages · Jump to latest',
        }[key] ?? key);
    `,
    '@/components/tools/knownTools': `export const knownTools = {}; export const getToolCategoryIcon = () => null;`,
    '@/components/tools/views/_all': `export const getToolViewComponent = () => null; export const getToolFullViewComponent = () => null;`,
    '@/components/tools/PermissionFooter': `export const PermissionFooter = () => null;`,
    '@/components/LongPressCopyable': `import { View } from 'react-native'; export const LongPressCopyable = View;`,
    '@/components/markdown/MarkdownView': `
        import React from 'react'; import { Text } from 'react-native';
        export const MarkdownView = ({ markdown }) => React.createElement(Text, { style: { fontSize: 16, lineHeight: 24 } }, markdown);
    `,
    '@/components/CodeView': `import React from 'react'; export const CodeView = ({ code }) => React.createElement('pre', null, code);`,
};

const fixturePlugin: Plugin = {
    name: 'chat-production-host',
    setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
            let key = args.path;
            if (key.startsWith('.') && args.importer.includes('/sources/')) {
                const absolute = resolve(dirname(args.importer), key);
                key = '@/' + absolute.slice(resolve(appRoot, 'sources').length + 1);
            }
            if (virtualModules[key]) return { path: key, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const source = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [source + '.web.tsx', source + '.ts', source + '.tsx'].find(existsSync);
                if (!path) throw new Error('Missing fixture source: ' + args.path);
                return { path };
            }
            return null;
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, args => ({ contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

describe('ChatList production FlashList browser interactions', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    beforeAll(async () => {
        const result = await build({
            stdin: {
                contents: `import { measureFirstChildLayout } from '@shopify/flash-list/dist/recyclerview/utils/measureLayout.web'; window.__measureFirstChildLayout = measureFirstChildLayout; import React from 'react'; import { createRoot } from 'react-dom/client'; import { ChatList } from '@/components/ChatList'; import { session } from '@/sync/storage'; createRoot(document.getElementById('root')).render(React.createElement(ChatList, { session, focusMessageId: new URLSearchParams(location.search).has('focus') ? 'user-24' : new URLSearchParams(location.search).has('focusWork') ? 'first-tool' : undefined }));`,
                resolveDir: appRoot, loader: 'tsx',
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            plugins: [fixturePlugin],
        });
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><main id="root"></main><script>globalThis.global=globalThis;${result.outputFiles[0].text}</script>`);
        });
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Browser fixture failed to bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true, args: ['--no-sandbox'] });
    }, 30000);
    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>(closed => server.close(() => closed()));
    }, 20000);

    it.each(['none', 'scaleY(-1)', 'scaleX(-1)'])('keeps the measured list origin stable through scrolling with transform %s', async transform => {
        const page = await browser.newPage();
        await page.goto(origin);
        const result = await page.evaluate(transform => {
            const parent = document.createElement('div');
            parent.style.cssText = 'position:absolute;left:100px;top:100px;width:300px;height:200px;';
            parent.style.transform = transform;
            const scroller = document.createElement('div');
            scroller.style.cssText = 'width:300px;height:200px;overflow:auto';
            const content = document.createElement('div');
            content.style.cssText = 'position:relative;width:900px;height:900px';
            const child = document.createElement('div');
            child.style.cssText = 'position:absolute;left:310px;top:330px;width:20px;height:10px';
            content.append(child); scroller.append(content); parent.append(scroller); document.body.append(parent);
            const before = (window as any).__measureFirstChildLayout(child, parent);
            scroller.scrollLeft = 100; scroller.scrollTop = 200;
            const after = (window as any).__measureFirstChildLayout(child, parent);
            parent.remove();
            return { before, after };
        }, transform);
        expect(result.before).toEqual({ x: 310, y: 330, width: 20, height: 10 });
        expect(result.after).toEqual(result.before);
        await page.close();
    });

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ] as const)('expands one work ribbon upward and collapses through the end Hide control on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        const work = page.getByRole('button', { name: /^Worked for/ });
        await work.waitFor({ state: 'attached', timeout: 5000 });
        await work.waitFor({ state: 'visible', timeout: 5000 });
        expect(await page.getByText('Inspect first file', { exact: true }).count()).toBe(0);
        const before = await work.boundingBox();
        await work.click();
        await page.getByText('Inspect first file', { exact: true }).waitFor({ state: 'visible' });
        const hide = page.getByRole('button', { name: 'Hide', exact: true });
        expect(await hide.count()).toBe(1);
        const end = await hide.boundingBox();
        const first = await page.getByText('Inspect first file', { exact: true }).boundingBox();
        expect(first!.y).toBeLessThan(end!.y);
        expect(Math.abs(end!.y - before!.y)).toBeLessThan(8);
        await hide.click();
        expect(await page.getByText('Inspect first file', { exact: true }).count()).toBe(0);
        expect(await page.getByText('Completed response', { exact: true }).isVisible()).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
    }, 20000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ] as const)('lets Hide close the work group opened by an exact message focus on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        await page.goto(origin + '?focusWork');
        await page.getByText('Inspect first file', { exact: true }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Hide', exact: true }).click();
        expect(await page.getByText('Inspect first file', { exact: true }).count()).toBe(0);
        expect(await page.getByRole('button', { name: /^Worked for/ }).getAttribute('aria-expanded')).toBe('false');
        await page.close();
    }, 20000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ] as const)('focuses an off-window receipt then follows the visible Jump to latest control on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        await page.goto(origin + '?focus');
        await page.getByRole('button', { name: 'Jump to latest', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
        await page.getByText('Prompt 24', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
        await expect.poll(async () => { const box = await page.getByText('Prompt 24', { exact: true }).boundingBox(); return box !== null && box.y >= 0 && box.y < viewport.height; }).toBe(true);
        const focusBounds = await page.getByText('Prompt 24', { exact: true }).boundingBox();
        expect(focusBounds!.y).toBeGreaterThanOrEqual(0);
        expect(focusBounds!.y).toBeLessThan(viewport.height);
        await page.evaluate(() => (window as any).__prepend());
        await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
        await page.getByText('Prompt 150', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
        await expect.poll(async () => { const box = await page.getByText('Prompt 150', { exact: true }).boundingBox(); return box !== null && box.y >= 0 && box.y < viewport.height; }).toBe(true);
        const latest = await page.getByText('Prompt 150', { exact: true }).boundingBox();
        expect(latest!.y).toBeGreaterThanOrEqual(0);
        expect(latest!.y).toBeLessThan(viewport.height);
        await page.close();
    }, 20000);
});
