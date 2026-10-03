import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const sourceRoot = resolve(appRoot, 'sources');
const modules: Record<string, string> = {
    'react-native': `export * from 'react-native-web';`,
    'react-native-unistyles': `
        import { lightTheme, darkTheme } from '@/theme';
        export const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
        export const useUnistyles = () => ({ theme });
        export const StyleSheet = { create: (factory) => typeof factory === 'function' ? factory(theme) : factory };
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top:0, right:0, bottom:0, left:0 });`,
    '@/utils/responsive': `export const useIsTablet = () => false;`,
    '@/components/AnimatedOverlay': `export const AnimatedBlurBackdrop = () => null;`,
    // MobileGlassSurface takes precisely this plain View branch when disabled
    // (as WebPromptModal supplies) or on Web. Native effects are outside this test.
    '@/components/MobileGlass': `
        import React from 'react'; import { View } from 'react-native';
        export const MobileGlassSurface = ({children,style}) => React.createElement(View,{style},children);
    `,
    'fixture-unused-custom-modal': `export const CustomModal = () => null;`,
    '@/text': `import en from '@/text/locales/en.json'; export const t = (key) => key.split('.').reduce((v,k)=>v?.[k],en) ?? key;`,
};
const plugin: Plugin = {
    name: 'production-prompt-provider-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === './components/CustomModal' && args.importer.endsWith('/modal/ModalProvider.tsx')) {
                return { path: 'fixture-unused-custom-modal', namespace: 'boundary' };
            }
            if (Object.hasOwn(modules, args.path)) return { path: args.path, namespace: 'boundary' };
            if (args.path.startsWith('@/')) {
                const base = resolve(sourceRoot, args.path.slice(2));
                const path = [base, `${base}.web.tsx`, `${base}.tsx`, `${base}.web.ts`, `${base}.ts`, `${base}.json`, `${base}/index.ts`].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
                if (!path) throw new Error(`Missing prompt fixture import: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => ({ contents: modules[args.path], loader: 'tsx', resolveDir: here }));
    },
};
const fixture = `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { ModalProvider } from '@/modal/ModalProvider';
    import { Modal } from '@/modal/ModalManager';
    import { theme } from 'react-native-unistyles';
    window.__PROMPT_THEME__ = theme.colors.kilv;
    window.__PROMPT_RESOLUTIONS__ = [];
    window.__PROMPT_SETTLEMENTS__ = [];
    // Observe the actual resolver function, not just a promise.then (which
    // JavaScript inherently runs once even if a buggy caller resolves twice).
    const resolvers = Modal.promptResolvers;
    const originalSet = resolvers.set.bind(resolvers);
    resolvers.set = (id, resolver) => originalSet(id, (value) => {
        window.__PROMPT_RESOLUTIONS__.push({ id, value });
        resolver(value);
    });
    window.__PROMPT_PENDING_COUNT__ = () => resolvers.size;
    function Entry() {
        const open = async () => {
            const value = await Modal.prompt('Rename workspace', 'Choose a name for this workspace.', {
                defaultValue: 'Original', placeholder: 'Workspace name', confirmText: 'Save', cancelText: 'Cancel',
            });
            window.__PROMPT_SETTLEMENTS__.push(value);
        };
        return <button id="open-prompt" onClick={open}>Open prompt</button>;
    }
    createRoot(document.getElementById('root')).render(<ModalProvider><Entry /></ModalProvider>);
`;

describe('production WebPromptModal through ModalProvider', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    beforeAll(async () => {
        const bundle = await build({
            stdin: { contents: fixture, loader: 'tsx', resolveDir: here },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.NODE_ENV': '"test"', 'process.env.EXPO_OS': '"web"' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            loader: { '.js': 'jsx' }, plugins: [plugin],
        });
        const script = bundle.outputFiles[0].text;
        const themeCss = readFileSync(resolve(sourceRoot, 'theme.css'), 'utf8');
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Prompt fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 60_000);
    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((done) => server.close(() => done()));
    });

    for (const [surface, viewport] of [
        ['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }],
    ] as const) for (const theme of ['light', 'dark'] as const) {
        it.each(['Enter', 'Save', 'Cancel', 'Escape', 'rapid confirm'] as const)(
            `${surface} ${theme}: %s resolves once and retains the owned dialog`, async (action) => {
                const page = await browser.newPage({ viewport });
                page.setDefaultTimeout(5_000);
                const errors: string[] = [];
                page.on('pageerror', (error) => errors.push(error.message));
                // A native browser prompt/confirm would violate this test's subject.
                page.on('dialog', (dialog) => { errors.push(`Unexpected native dialog: ${dialog.type()}`); void dialog.dismiss(); });
                try {
                    await page.goto(`${origin}/?theme=${theme}`);
                    const opener = page.getByRole('button', { name: 'Open prompt', exact: true });
                    await opener.click();
                    const input = page.getByPlaceholder('Workspace name', { exact: true });
                    await input.waitFor({ state: 'visible', timeout: 3_000 });
                    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 3_000 });
                    await expect.poll(() => input.evaluate((node) => node === document.activeElement)).toBe(true);
                    expect(await input.inputValue()).toBe('Original');
                    await input.fill('Updated name');
                    const geometry = () => input.evaluate((node) => {
                        const card = node.parentElement!.parentElement!;
                        const rect = card.getBoundingClientRect();
                        return { x: Math.round(rect.x), width: Math.round(rect.width), bottom: Math.round(rect.bottom), center: Math.round(rect.y + rect.height / 2) };
                    });
                    // Wait for the existing 200ms opening scale; do not disable animation.
                    await expect.poll(async () => (await geometry()).width).toBe(surface === 'mobile' ? 374 : 360);
                    const box = await geometry();
                    if (surface === 'mobile') expect(box).toMatchObject({ x: 8, width: 374, bottom: 836 });
                    else expect(box).toMatchObject({ x: 540, width: 360, center: 450 });
                    const styles = await input.evaluate((node) => {
                        const theme = (window as any).__PROMPT_THEME__;
                        const normalize = (color: string) => {
                            const probe = document.createElement('span'); probe.style.color = color;
                            document.body.append(probe); const result = getComputedStyle(probe).color; probe.remove(); return result;
                        };
                        const field = getComputedStyle(node);
                        const card = getComputedStyle(node.parentElement!.parentElement!);
                        return {
                            background: card.backgroundColor, expectedBackground: normalize(theme.stone), radius: card.borderRadius,
                            ink: field.color, expectedInk: normalize(theme.stoneInk), border: field.borderColor,
                            expectedBorder: normalize(theme.molten), fontSize: field.fontSize,
                        };
                    });
                    expect(styles.background).toBe(styles.expectedBackground);
                    expect(styles.ink).toBe(styles.expectedInk);
                    expect(styles.border).toBe(styles.expectedBorder);
                    expect(styles.radius).toBe('6px');
                    expect(styles.fontSize).toBe('16px');

                    // closeOnBackdrop=false is the current prompt contract. A
                    // backdrop press must retain the draft and unresolved promise.
                    await page.mouse.click(2, 2);
                    expect(await input.inputValue()).toBe('Updated name');
                    expect(await page.evaluate(() => (window as any).__PROMPT_RESOLUTIONS__)).toEqual([]);
                    expect(await page.evaluate(() => (window as any).__PROMPT_PENDING_COUNT__())).toBe(1);
                    await input.focus();
                    if (action === 'Enter') await input.press('Enter');
                    else if (action === 'Escape') await page.keyboard.press('Escape');
                    else if (action === 'rapid confirm') await page.getByRole('button', { name: 'Save', exact: true }).evaluate((node) => {
                        (node as HTMLElement).click(); (node as HTMLElement).click();
                    });
                    else await page.getByRole('button', { name: action, exact: true }).click();
                    const expected = action === 'Cancel' || action === 'Escape' ? null : 'Updated name';
                    await expect.poll(() => page.evaluate(() => (window as any).__PROMPT_SETTLEMENTS__)).toEqual([expected]);
                    expect(await page.evaluate(() => (window as any).__PROMPT_RESOLUTIONS__.map((entry: any) => entry.value))).toEqual([expected]);
                    expect(await page.evaluate(() => (window as any).__PROMPT_PENDING_COUNT__())).toBe(0);
                    await input.waitFor({ state: 'detached', timeout: 3_000 });
                    // RN Web captures the already-autofocused input, so automatic
                    // opener restoration is not an existing baseline contract.
                    expect(await opener.isVisible()).toBe(true);
                    expect(await opener.isEnabled()).toBe(true);
                    await opener.focus();
                    expect(await opener.evaluate((node) => node === document.activeElement)).toBe(true);
                    // A subsequent prompt starts fresh, and no late callback
                    // from the first prompt closes or resolves this new one.
                    await opener.click();
                    await input.waitFor({ state: 'visible', timeout: 3_000 });
                    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 3_000 });
                    await expect.poll(() => input.evaluate((node) => node === document.activeElement)).toBe(true);
                    expect(await input.inputValue()).toBe('Original');
                    expect(await page.evaluate(() => (window as any).__PROMPT_SETTLEMENTS__)).toEqual([expected]);
                    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
                    await expect.poll(() => page.evaluate(() => (window as any).__PROMPT_SETTLEMENTS__)).toEqual([expected, null]);
                    expect(await page.evaluate(() => (window as any).__PROMPT_RESOLUTIONS__.map((entry: any) => entry.value))).toEqual([expected, null]);
                    expect(errors).toEqual([]);
                } finally { await page.close(); }
            }, 20_000,
        );
    }
});
