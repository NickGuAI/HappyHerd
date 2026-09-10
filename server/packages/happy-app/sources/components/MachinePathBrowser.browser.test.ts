import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

const directoryEntries = [
    { name: '.private', path: '/work/.private', type: 'directory' },
    ...Array.from({ length: 24 }, (_, index) => ({
        name: `folder-${String(index).padStart(2, '0')}`,
        path: `/work/folder-${String(index).padStart(2, '0')}`,
        type: 'directory',
    })),
    { name: '.cache', path: '/work/.cache', type: 'file' },
];

const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        export const Platform = {
            ...ReactNativeWeb.Platform,
            OS: 'web',
            select: (options) => options.web ?? options.default,
        };
    `,
    'react-native-unistyles': `
        const theme = {
            colors: {
                divider: '#d8d8d8', text: '#171717', textSecondary: '#666',
                switch: {
                    track: { inactive: '#ccc', active: '#111' },
                    thumb: { active: '#fff' },
                },
            },
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name });
    `,
    '@/components/BubblePressable': `
        import React from 'react';
        import { Pressable } from 'react-native';
        export const BubblePressable = ({ scaleFeedback, style, ...props }) => React.createElement(
            Pressable,
            { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style },
            props.children,
        );
    `,
    '@/sync/ops': `
        const children = ${JSON.stringify(directoryEntries)};
        export const machineGetDirectoryTree = async (_machineId, path) => ({
            success: true,
            tree: { name: 'work', path, type: 'directory', children },
        });
    `,
    '@/utils/sessionUtils': `export const formatPathRelativeToHome = (path) => path;`,
    '@/utils/hostPath': `
        export const hostRoot = () => '/';
        export const parentHostPath = () => '/';
    `,
    '@/text': `
        const labels = {
            'newSession.showHidden': 'Show hidden',
            'uiCopy.hostFolders': 'Host folders',
            'uiCopy.useThisFolder': 'Use this folder',
            'uiCopy.folderIsEmpty': 'Folder is empty',
            'uiCopy.selected': 'Selected',
        };
        export const t = (key, params = {}) => {
            if (key === 'uiCopy.openFolderValue') return 'Open folder ' + params.value1;
            if (key === 'uiCopy.useValueAsWorkspace') return 'Use ' + params.value1 + ' as workspace';
            if (key === 'uiCopy.useFavoriteValue') return 'Use favorite ' + params.value1;
            return labels[key] ?? key;
        };
    `,
};

const fixturePlugin: Plugin = {
    name: 'machine-path-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
    },
};

async function swipeUp(page: Page, x: number, startY: number, endY: number) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= 6; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: startY + ((endY - startY) * step / 6) }],
        });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
}

describe('MachinePathBrowser Web journeys', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import { MachinePathBrowser } from '@/components/MachinePathBrowser';
                    import { NewSessionPathScrollView } from '@/components/NewSessionPathScrollView';
                    import {
                        getNewSessionSidebarLayout,
                        NEW_SESSION_PANEL_ROW_FONT_SIZE,
                    } from '@/utils/newSessionSidebarLayout';

                    const recentPaths = Array.from({ length: 24 }, (_, index) =>
                        '/workspace/products/happyherd/example-project-' + String(index).padStart(2, '0')
                    );

                    function ReadabilityPanel() {
                        const layout = getNewSessionSidebarLayout({
                            platform: 'web',
                            isMac: false,
                            fileDiffsSidebarEnabled: true,
                            zenMode: false,
                            windowWidth: window.innerWidth,
                        });
                        if (!layout.showSidebar) return null;

                        const rowStyle = {
                            alignItems: 'center',
                            boxSizing: 'border-box',
                            display: 'flex',
                            fontSize: NEW_SESSION_PANEL_ROW_FONT_SIZE,
                            gap: 12,
                            minWidth: 0,
                            padding: '12px',
                            width: '100%',
                        };
                        const textStyle = {
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        };

                        return <div
                            data-testid="new-session-readability-panel"
                            style={{ boxSizing: 'border-box', padding: 12, width: layout.sidebarWidth }}
                        >
                            <div style={rowStyle}>
                                <span aria-hidden="true">◉</span>
                                <span data-testid="model-slug" style={textStyle}>claude-sonnet-4-5</span>
                            </div>
                            <div style={rowStyle}>
                                <span aria-hidden="true">⌂</span>
                                <span data-testid="recent-path" style={textStyle}>
                                    /workspace/products/happyherd/server/packages/happy-app/sources/components
                                </span>
                            </div>
                        </div>;
                    }

                    function Fixture() {
                        return <>
                            <ReadabilityPanel />
                            <div data-testid="outer-scroll" style={{ height: 520, overflowY: 'auto' }}>
                                <div style={{ height: 40 }} />
                                <div style={{ width: 700, maxWidth: '100%' }}>
                                    <MachinePathBrowser
                                        machineId="machine-1"
                                        homeDir="/work"
                                        platform="linux"
                                        online
                                        selectedPath="/work"
                                        favorites={[]}
                                        onSelectPath={() => {}}
                                        onToggleFavorite={() => {}}
                                    />
                                </div>
                                <NewSessionPathScrollView
                                    testID="new-session-recent-path-list-fixture"
                                    maxHeight={176}
                                    style={{ width: 700, maxWidth: '100%' }}
                                >
                                    {recentPaths.map((path) => (
                                        <div key={path} style={{ fontSize: 16, minHeight: 38, padding: '8px 12px' }}>
                                            {path}
                                        </div>
                                    ))}
                                </NewSessionPathScrollView>
                                <div data-testid="outer-scroll-zone" style={{ height: 400 }} />
                                <div style={{ height: 500 }} />
                            </div>
                        </>;
                    }

                    createRoot(document.getElementById('root')).render(<Fixture />);
                `,
                loader: 'tsx',
                resolveDir: appRoot,
            },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            sourcemap: 'inline',
            define: {
                __DEV__: 'false',
                'process.env.EXPO_OS': '"web"',
                'process.env.NODE_ENV': '"test"',
            },
            jsx: 'automatic',
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0;font-family:Arial,sans-serif}</style><main id="root"></main><script>globalThis.global=globalThis;${script}</script>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('browser fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    it('shows hidden entries by default and filters dot entries with the visible switch', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.goto(origin);

        await expect(page.getByText('.private').isVisible()).resolves.toBe(true);
        await expect(page.getByText('.cache').isVisible()).resolves.toBe(true);
        const toggle = page.getByRole('switch', { name: 'Show hidden' });
        await expect(toggle.isChecked()).resolves.toBe(true);
        await toggle.click();
        await expect(page.getByText('.private').count()).resolves.toBe(0);
        await expect(page.getByText('.cache').count()).resolves.toBe(0);
        await expect(page.getByText('folder-00').isVisible()).resolves.toBe(true);

        await expect(page.getByText('Use this folder').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
        await expect(page.getByText('Host folders').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('13px');
        await expect(page.getByText('folder-00').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
        expect(pageErrors).toEqual([]);
        await page.close();
    });

    it.each([
        { width: 1440, height: 900 },
        { width: 1920, height: 1000 },
    ])('renders a 720px panel at $width px without truncating representative model and path text', async ({ width, height }) => {
        const page = await browser.newPage({ viewport: { width, height } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.goto(origin);

        await expect(page.getByTestId('new-session-readability-panel').evaluate((element) => element.getBoundingClientRect().width)).resolves.toBe(720);
        for (const testId of ['model-slug', 'recent-path']) {
            await expect(page.getByTestId(testId).evaluate((element) => ({
                clientWidth: element.clientWidth,
                fontSize: getComputedStyle(element).fontSize,
                scrollWidth: element.scrollWidth,
            }))).resolves.toMatchObject({ fontSize: '16px' });
            await expect(page.getByTestId(testId).evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
        }

        expect(pageErrors).toEqual([]);
        await page.close();
    });

    it('lets touch gestures scroll folder and recent lists while the surrounding page remains scrollable', async () => {
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
        });
        const page = await context.newPage();
        await page.goto(origin);

        const tree = page.getByTestId('machine-path-browser-tree');
        await expect(tree.evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            touchAction: getComputedStyle(element).touchAction,
        }))).resolves.toMatchObject({ clientHeight: 260, touchAction: 'pan-y' });
        await expect(tree.evaluate((element) => element.scrollHeight > element.clientHeight)).resolves.toBe(true);

        const treeBox = await tree.boundingBox();
        if (!treeBox) throw new Error('folder list has no browser layout box');
        await swipeUp(page, treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height - 20, treeBox.y + 30);
        await expect(tree.evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(50);

        const recentPaths = page.getByTestId('new-session-recent-path-list-fixture');
        await recentPaths.scrollIntoViewIfNeeded();
        await expect(recentPaths.evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            touchAction: getComputedStyle(element).touchAction,
        }))).resolves.toMatchObject({ clientHeight: 176, touchAction: 'pan-y' });
        await expect(recentPaths.evaluate((element) => element.scrollHeight > element.clientHeight)).resolves.toBe(true);

        const recentBox = await recentPaths.boundingBox();
        if (!recentBox) throw new Error('recent path list has no browser layout box');
        await swipeUp(page, recentBox.x + recentBox.width / 2, recentBox.y + recentBox.height - 20, recentBox.y + 30);
        await expect(recentPaths.evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(50);

        const outer = page.getByTestId('outer-scroll');
        const outerZone = page.getByTestId('outer-scroll-zone');
        await outerZone.scrollIntoViewIfNeeded();
        const outerScrollTopBefore = await outer.evaluate((element) => element.scrollTop);
        const outerZoneBox = await outerZone.boundingBox();
        if (!outerZoneBox) throw new Error('outer page scroll zone has no browser layout box');
        await swipeUp(
            page,
            outerZoneBox.x + outerZoneBox.width / 2,
            Math.min(outerZoneBox.y + outerZoneBox.height - 20, 500),
            Math.max(outerZoneBox.y + 30, 180),
        );
        await expect(outer.evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(outerScrollTopBefore);

        await context.close();
    });
});
