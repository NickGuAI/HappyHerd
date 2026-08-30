import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

const virtualModules: Record<string, string> = {
    'react-native-unistyles': `
        const colors = new Proxy({
            text: '#111', textSecondary: '#666', textDestructive: '#c00', textLink: '#06c',
            divider: '#ddd', surface: '#fff', surfaceHigh: '#f3f3f3', warning: '#a60',
            groupped: { background: '#f5f5f5' }, input: { background: '#eee' },
            header: { background: '#fff', tint: '#111' },
        }, { get: (target, key) => target[key] ?? '#111' });
        const theme = { dark: false, colors };
        export const StyleSheet = {
            hairlineWidth: 1,
            absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
            create: (factory) => typeof factory === 'function' ? factory(theme) : factory,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const glyph = { 'chevron-back': '‹', 'chevron-forward': '›', 'chevron-left': '‹', plus: '+', x: '×' };
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name }, glyph[name] ?? '•');
        Icon.glyphMap = {};
        export const Ionicons = Icon;
        export const Octicons = Icon;
    `,
    'expo-image': `
        import React from 'react';
        import { View } from 'react-native';
        export const Image = ({ style, testID }) => React.createElement(View, { style, testID, 'data-image': 'true' });
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'expo-router': `export const useRouter = () => ({ back() {}, push() {} });`,
    'expo-router/drawer': `
        import React from 'react';
        import { View } from 'react-native';
        export const Drawer = ({ screenOptions, drawerContent }) => React.createElement(
            View,
            {
                testID: 'navigation-drawer',
                style: [{ position: 'absolute', top: 0, bottom: 0, left: 0 }, screenOptions.drawerStyle],
            },
            drawerContent ? drawerContent() : null,
        );
    `,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: true });`,
    '@/components/SidebarView': `
        import React from 'react';
        export const SidebarView = () => React.createElement(
            'div',
            {
                'data-testid': 'sidebar-content',
                style: { height: '100%', padding: 20, background: '#f5f5f5', color: '#555' },
            },
            'HappyHerd navigation',
        );
    `,
    '@/sync/storage': `
        import React from 'react';
        const settings = { navigationSidebarCollapsed: false, zenMode: false };
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        const session = {
            id: 'ordinary-session',
            metadata: { path: '/workspace', host: 'fixture', machineId: 'machine-1', flavor: 'claude' },
        };
        const machine = { id: 'machine-1', metadata: { supportsFileDelete: true } };
        export const useLocalSetting = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        export const useLocalSettingMutable = (key) => [
            React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]),
            (value) => { settings[key] = value; emit(); },
        ];
        export const useSession = (id) => id === session.id ? session : null;
        export const useMachine = (id) => id === machine.id ? machine : null;
        export const storage = { getState: () => ({ sessions: { [session.id]: session }, machines: { [machine.id]: machine } }) };
    `,
    '@/utils/responsive': `
        export const useHeaderHeight = () => 64;
        export const useIsTablet = () => true;
    `,
    '@/utils/isTauri': `export const isTauri = () => false;`,
    '@/hooks/useTauriZoom': `export const DEFAULT_APP_ZOOM = 1;`,
    '@/navigation/browserNavigation': `
        export const canRouteForward = () => false;
        export const canUseRouteBack = () => false;
        export const getNavigatorCanGoBack = () => false;
    `,
    '@/navigation/browserNavigationStore': `
        const state = { routeHistory: null, markRouteBack() {}, markRouteForward() {} };
        export const useBrowserNavigationStore = (selector) => selector(state);
        useBrowserNavigationStore.getState = () => state;
    `,
    '@/-session/sessionOverlayNav': `
        const state = { canBack: false, canForward: false, back: () => false, forward: () => false };
        export const useOverlayNav = (selector) => selector(state);
        useOverlayNav.getState = () => state;
    `,
    '@/components/StyledText': `
        import React from 'react';
        import { Text as NativeText } from 'react-native';
        export const Text = (props) => React.createElement(NativeText, props, props.children);
    `,
    '@/constants/Typography': `export const Typography = { default: () => ({}) };`,
    '@/components/FileIcon': `
        import React from 'react';
        export const FileIcon = () => React.createElement('span', { 'data-file-icon': 'true' }, '▧');
    `,
    '@/components/markdown/MarkdownView': `
        import React from 'react';
        export const MarkdownView = ({ markdown }) => React.createElement('div', { 'data-testid': 'markdown-preview' }, markdown);
    `,
    '@/components/diff/PierreDiffView': `export const PierreDiffView = () => null;`,
    '@/components/FileDocumentPreview': `export const FileDocumentPreview = () => null;`,
    '@/components/CodeEditor': `
        import React from 'react';
        export const CodeEditor = ({ value, onChange, readOnly }) => React.createElement('textarea', {
            'data-testid': 'code-editor',
            'data-read-only': String(readOnly),
            readOnly,
            value,
            onChange: (event) => onChange(event.currentTarget.value),
        });
    `,
    '@/sync/ops': `
        const content = btoa('# Desktop workspace\\n');
        export const sessionReadFile = async () => ({ success: true, content });
        export const sessionWriteFile = async () => ({ success: true, hash: 'saved-hash' });
        export const sessionDeleteFile = async () => {
            window.__DELETE_RPC_COUNT__ = (window.__DELETE_RPC_COUNT__ ?? 0) + 1;
            return { success: true };
        };
    `,
    '@/modal': `
        export const Modal = {
            alert() {},
            confirm: async () => true,
        };
    `,
    '@/components/layout': `export const layout = { maxWidth: 1200 };`,
    '@/text': `
        export const t = (key, params) => ({
            'common.back': 'Back',
            'common.cancel': 'Cancel',
            'common.error': 'Error',
            'files.allFiles': 'All Files',
            'files.cannotDisplayBinary': 'Cannot display binary',
            'files.closeFileTab': 'Close ' + (params?.name ?? ''),
            'files.deleteFile': 'Delete',
            'files.deleteFileDescription': 'This permanently removes the selected file.',
            'files.deleteFileTitle': 'Delete file?',
            'files.editFile': 'Edit',
            'files.failedToDelete': 'Failed to delete file',
            'files.failedToRead': 'Failed to read file',
            'files.openExistingFile': 'Open existing file',
            'files.openFileTab': 'Open ' + (params?.name ?? ''),
            'files.resizeWorkspace': 'Resize file workspace',
            'navigation.collapseSidebar': 'Collapse navigation',
            'navigation.expandSidebar': 'Expand navigation',
            'uiCopy.preview': 'Preview',
            'uiCopy.previewOfValue': 'Preview',
            'uiCopy.saved': 'Saved',
            'uiCopy.saving': 'Saving',
            'uiCopy.source': 'Source',
            'uiCopy.unsaved': 'Unsaved',
            'zen.toggle': 'Toggle Zen mode',
        }[key] ?? key);
    `,
};

const fixturePlugin: Plugin = {
    name: 'desktop-workspace-browser-fixture',
    setup(buildContext) {
        buildContext.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path === './SidebarView') return { path: '@/components/SidebarView', namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, sourcePath + '.ts', sourcePath + '.tsx'].find(existsSync);
                if (!path) throw new Error('missing fixture source: ' + args.path);
                return { path };
            }
            return null;
        });
        buildContext.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
    },
};

function recordPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

describe('Desktop workspace browser interaction', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/desktopWorkspace.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            alias: { 'react-native': 'react-native-web' },
            loader: { '.png': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<style>html,body,#root{margin:0;min-height:100%;font-family:sans-serif}*{box-sizing:border-box}</style><main id="root"></main><script>' + script + '</script>');
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('browser fixture did not bind');
        origin = 'http://127.0.0.1:' + address.port;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        try {
            browser = await chromium.launch({
                ...(executablePath ? { executablePath } : { channel: 'chrome' }),
                headless: true,
                args: process.platform === 'linux' ? ['--no-sandbox'] : [],
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(
                'Desktop workspace browser tests require an installed Google Chrome. '
                + 'Set HAPPYHERD_BROWSER_EXECUTABLE to override browser discovery. '
                + detail,
            );
        }
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    it('uses the real boundary toggle and pointer divider without overlapping or remounting', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const sidebarDemo = page.getByTestId('sidebar-demo');
        const drawer = page.getByTestId('navigation-drawer');
        const collapse = page.getByTestId('navigation-sidebar-toggle');
        await collapse.waitFor();
        await expect(collapse.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
        const sidebarBox = await sidebarDemo.boundingBox();
        const drawerBox = await drawer.boundingBox();
        const collapseBox = await collapse.boundingBox();
        if (!sidebarBox || !drawerBox || !collapseBox) throw new Error('sidebar fixture has no layout');
        expect(Math.abs(collapseBox.x + collapseBox.width / 2 - drawerBox.x - drawerBox.width)).toBeLessThan(2);
        expect(Math.abs(collapseBox.y - sidebarBox.y - 15)).toBeLessThan(2);

        await collapse.click();
        const expand = page.getByTestId('navigation-sidebar-toggle');
        await expand.waitFor();
        await expect(expand.getAttribute('aria-label')).resolves.toBe('Expand navigation');
        const expandBox = await expand.boundingBox();
        const zenBox = await page.getByLabel('Toggle Zen mode').boundingBox();
        if (!expandBox || !zenBox) throw new Error('collapsed controls have no layout');
        expect(expandBox.x + expandBox.width).toBeLessThanOrEqual(zenBox.x);
        await expand.click();
        await expect(collapse.getAttribute('aria-label')).resolves.toBe('Collapse navigation');

        const splitDemo = page.getByTestId('split-demo');
        const host = splitDemo.getByTestId('desktop-file-workspace-host');
        const divider = splitDemo.getByTestId('desktop-file-workspace-divider');
        const input = splitDemo.getByTestId('mounted-workspace-input');
        await input.fill('human draft survives');
        const initialHostBox = await host.boundingBox();
        const initialDividerBox = await divider.boundingBox();
        const initialMountId = await splitDemo.getByTestId('mounted-workspace-probe').getAttribute('data-mount-id');
        if (!initialHostBox || !initialDividerBox || !initialMountId) throw new Error('split fixture has no layout');

        await page.mouse.move(
            initialDividerBox.x + initialDividerBox.width / 2,
            initialDividerBox.y + initialDividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(initialDividerBox.x - 140, initialDividerBox.y + initialDividerBox.height / 2, { steps: 8 });
        await page.mouse.up();

        const resizedHostBox = await host.boundingBox();
        if (!resizedHostBox) throw new Error('resized host has no layout');
        expect(resizedHostBox.width).toBeGreaterThan(initialHostBox.width + 100);
        await expect(splitDemo.getByTestId('mounted-workspace-probe').getAttribute('data-mount-id')).resolves.toBe(initialMountId);
        await expect(input.inputValue()).resolves.toBe('human draft survives');
        await expect(splitDemo.getByTestId('main-agent-chat').isVisible()).resolves.toBe(true);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('keeps wide controls focused and narrow controls complete in the real file workspace', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const wide = page.getByTestId('wide-file-workspace');
        await wide.getByRole('button', { name: 'Source' }).waitFor();
        await expect(wide.getByRole('button', { name: 'Preview' }).count()).resolves.toBe(0);
        await expect(wide.getByRole('button', { name: 'Edit' }).count()).resolves.toBe(1);
        await expect(wide.getByRole('button', { name: 'Delete' }).count()).resolves.toBe(1);
        await expect(wide.getByTestId('markdown-preview').isVisible()).resolves.toBe(true);

        await wide.getByRole('button', { name: 'Source' }).click();
        await wide.getByTestId('code-editor').waitFor();
        await expect(wide.getByTestId('code-editor').getAttribute('data-read-only')).resolves.toBe('true');
        await wide.getByRole('button', { name: 'Source' }).click();
        await expect(wide.getByTestId('markdown-preview').isVisible()).resolves.toBe(true);
        await wide.getByRole('button', { name: 'Edit' }).click();
        await expect(wide.getByTestId('code-editor').getAttribute('data-read-only')).resolves.toBe('false');
        await wide.getByRole('button', { name: 'Delete' }).click();
        await expect(page.evaluate(() => (window as any).__DELETE_RPC_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FILE_DELETED_COUNT__ ?? 0)).resolves.toBe(1);

        const narrow = page.getByTestId('narrow-file-workspace');
        await narrow.getByTestId('desktop-file-workspace-fullscreen-header').waitFor();
        await expect(narrow.getByTestId('desktop-file-workspace-divider').count()).resolves.toBe(0);
        await expect(narrow.getByRole('tab').count()).resolves.toBe(0);
        await narrow.getByRole('button', { name: 'Source' }).waitFor();
        await expect(narrow.getByRole('button', { name: 'Preview' }).count()).resolves.toBe(1);
        await expect(narrow.getByRole('button', { name: 'Edit' }).count()).resolves.toBe(1);
        await expect(narrow.getByRole('button', { name: 'Delete' }).count()).resolves.toBe(0);
        await narrow.getByRole('button', { name: 'Source' }).click();
        await narrow.getByTestId('code-editor').waitFor();
        await narrow.getByRole('button', { name: 'Preview' }).click();
        await expect(narrow.getByTestId('markdown-preview').isVisible()).resolves.toBe(true);

        const evidenceDirectory = process.env.HAPPYHERD_ISSUE_181_EVIDENCE_DIR;
        if (evidenceDirectory) {
            await sidebarDemoScreenshot(page, evidenceDirectory);
            await page.getByTestId('split-demo').screenshot({ path: resolve(evidenceDirectory, 'issue-181-wide.png') });
            await narrow.screenshot({ path: resolve(evidenceDirectory, 'issue-181-mobile.png') });
        }
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});

async function sidebarDemoScreenshot(page: Page, evidenceDirectory: string): Promise<void> {
    await page.getByTestId('sidebar-demo').screenshot({
        path: resolve(evidenceDirectory, 'issue-181-standard.png'),
    });
}
