import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import en from '@/text/locales/en.json';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const reportDirectory = '/tmp/happyherd-local-voice';

function label(key: string): string {
    const value = key.split('.').reduce((node: any, part) => node?.[part], en);
    if (typeof value !== 'string') throw new Error(`missing catalog key ${key}`);
    return value;
}

const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        export const Platform = { ...ReactNativeWeb.Platform, OS: 'web', select: (options) => options.web ?? options.default };
    `,
    'react-native-unistyles': `
        import { lightTheme } from '@/theme';
        const theme = lightTheme;
        export const StyleSheet = { create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory, hairlineWidth: 1 };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `import React from 'react'; export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name });`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/components/BubblePressable': `import { Pressable } from 'react-native'; export const BubblePressable = Pressable;`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    '@/components/CommanderAvatarSettings': `export const CommanderAvatarSettings = () => null;`,
    '@/components/herd/pages/SettingsFrame': `export const withSettingsFrame = (_section, Screen) => Screen;`,
    '@/constants/Typography': `export const Typography = { default: () => ({}), mono: () => ({}), logo: () => ({}) };`,
    '@/modal': `export const Modal = { alert: () => {}, confirm: async () => false, prompt: async () => undefined };`,
    '@/sync/storage': `
        import React from 'react';
        const subscribe = (listener) => { addEventListener('voice-state', listener); return () => removeEventListener('voice-state', listener); };
        const read = (key) => React.useSyncExternalStore(subscribe, () => globalThis.__VOICE_STATE__[key]);
        export const useAllMachines = () => read('machines');
        export const useMachine = (id) => globalThis.__VOICE_STATE__.machines.find((machine) => machine.id === id) ?? null;
        export const useSetting = (key) => read(key);
        export const useSettingMutable = (key) => [read(key), (value) => globalThis.__VOICE_UPDATE__({ [key]: value })];
        export const useLocalSettingMutable = (key) => [read(key), (value) => globalThis.__VOICE_UPDATE__({ [key]: value })];
    `,
    '@/sync/apiSocket': `
        export const apiSocket = {
            async machineRPC(machineId, method, params) {
                const calls = globalThis.__VOICE_STATE__.calls;
                calls.push({ machineId, method, params });
                if (method === 'happyherd-voice-status') return globalThis.__VOICE_STATE__.voiceStatus;
                if (method === 'happyherd-voice-install') {
                    if (globalThis.__VOICE_STATE__.failInstallOnce) {
                        globalThis.__VOICE_UPDATE__({ failInstallOnce: false });
                        throw new Error('Voice install request unavailable');
                    }
                    globalThis.__VOICE_UPDATE__({ voiceStatus: { ...globalThis.__VOICE_STATE__.voiceStatus, [params.feature]: { state: 'installing' } } });
                    return { operationId: 'install-operation', kind: 'install', state: 'running' };
                }
                return { ok: true };
            },
        };
    `,
    '@/text': `
        import catalog from '@/text/locales/en.json';
        export const t = (key, params = {}) => key.split('.').reduce((value, part) => value?.[part], catalog) ?? key;
    `,
};

const fixturePlugin: Plugin = {
    name: 'local-voice-settings-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'local-voice-stub' };
            if (args.path === './BubblePressable' && args.importer.endsWith('/sources/components/Item.tsx')) {
                return { path: '@/components/BubblePressable', namespace: 'local-voice-stub' };
            }
            if (args.path === './apiSocket' && args.importer.endsWith('/sources/sync/localVoice.ts')) {
                return { path: '@/sync/apiSocket', namespace: 'local-voice-stub' };
            }
            if (args.path === './layout' && args.importer.endsWith('/sources/components/ItemGroup.tsx')) {
                return { path: '@/components/layout', namespace: 'local-voice-stub' };
            }
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}.json`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'local-voice-stub' }, (args) => ({
            contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot,
        }));
    },
};

const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import FeaturesScreen from '@/app/(app)/settings/features';
    globalThis.__VOICE_STATE__ = {
        machines: [
            { id: 'main-mac', active: true, createdAt: 1, activeAt: 1, metadata: { displayName: 'Main Mac', happyCliVersion: '1.0.0' } },
            { id: 'voice-mac', active: true, createdAt: 2, activeAt: 2, metadata: { displayName: 'Voice Mac', happyCliVersion: '1.0.0' } },
        ],
        calls: [],
        voiceStatus: { stt: { state: 'not-installed' }, tts: { state: 'not-installed' } },
        failInstallOnce: false,
        localVoiceMachineId: null, localVoiceSttEnabled: false, localVoiceTtsEnabled: false,
        experiments: false, markdownCopyV2: false, hideInactiveSessions: false, machineWorkspace: false,
        expContextWindow: false, expImageUpload: false, commanderProfilePictures: false, userSafeguardEnabled: false,
    };
    globalThis.__VOICE_UPDATE__ = (patch) => { globalThis.__VOICE_STATE__ = { ...globalThis.__VOICE_STATE__, ...patch }; dispatchEvent(new Event('voice-state')); };
    createRoot(document.getElementById('root')).render(React.createElement(FeaturesScreen));
`;

describe('local voice in the rendered Experimental Features settings', { timeout: 30_000 }, () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        mkdirSync(reportDirectory, { recursive: true });
        const bundle = await build({
            stdin: { contents: entry, loader: 'tsx', resolveDir: appRoot },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><main id="root"></main><script>globalThis.global=globalThis;${script}</script>`);
        });
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('fixture bind failed');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((done) => server.close(() => done()));
    });

    for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
        it(`keeps local engines opt-in, lets the user choose a machine and shows daemon readiness at ${viewport.width}px`, async () => {
            const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
            await page.addInitScript((size) => { (window as any).__VIEWPORT__ = size; }, { width: viewport.width, height: viewport.height });
            const errors: string[] = [];
            page.setDefaultTimeout(4_000);
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(origin);

            const groupTitle = page.getByText(label('happyHerd.localVoice.title'), { exact: true });
            try {
                await groupTitle.waitFor();
            } catch {
                throw new Error(`Features page did not render: ${errors.join('\n') || '(no browser error captured)'}`);
            }
            await groupTitle.scrollIntoViewIfNeeded();
            const experimentsTitle = page.getByText(label('settingsFeatures.experiments'), { exact: true });
            await expect.poll(() => page.evaluate(([experiments, localVoice]) => {
                const leaves = [...document.querySelectorAll('*')].filter((node) => node.children.length === 0);
                const heading = leaves.find((node) => node.textContent?.trim() === experiments);
                const localVoiceTitle = leaves.find((node) => node.textContent?.trim() === localVoice);
                if (!heading || !localVoiceTitle) return false;
                for (let ancestor = heading.parentElement; ancestor; ancestor = ancestor.parentElement) {
                    const children = [...ancestor.children];
                    if (children.some((child) => child.contains(heading))
                        && children.some((child) => child !== ancestor && child.contains(localVoiceTitle)
                            && !children.find((headingChild) => headingChild.contains(heading))?.contains(localVoiceTitle))) return true;
                }
                return false;
            }, [label('settingsFeatures.experiments'), label('happyHerd.localVoice.title')])).toBe(true);
            const stt = page.getByRole('switch', { name: label('happyHerd.localVoice.sttTitle') });
            const tts = page.getByRole('switch', { name: label('happyHerd.localVoice.ttsTitle') });
            await expect(stt.isChecked()).resolves.toBe(false);
            await expect(tts.isChecked()).resolves.toBe(false);

            await page.getByText(label('happyHerd.localVoice.voiceMachine'), { exact: true }).click();
            await page.getByText('Voice Mac', { exact: true }).waitFor();
            await page.getByText('Voice Mac', { exact: true }).click();
            await stt.scrollIntoViewIfNeeded();
            await stt.click();
            await page.getByText(label('happyHerd.localVoice.downloading'), { exact: true }).waitFor();
            await expect(stt.isChecked()).resolves.toBe(true);
            await expect(stt.isDisabled()).resolves.toBe(false);
            await expect.poll(() => page.evaluate(() => (window as any).__VOICE_STATE__.calls.some((call: any) =>
                call.machineId === 'voice-mac' && call.method === 'happyherd-voice-install' && call.params.feature === 'stt'))).toBe(true);

            await stt.click();
            await expect(stt.isChecked()).resolves.toBe(false);
            await expect(stt.isDisabled()).resolves.toBe(true);

            await page.evaluate(() => (window as any).__VOICE_UPDATE__({ voiceStatus: { stt: { state: 'ready' }, tts: { state: 'not-installed' } } }));
            await page.getByText(label('happyHerd.localVoice.ready'), { exact: true }).waitFor();
            await page.evaluate(() => (window as any).__VOICE_UPDATE__({ failInstallOnce: true }));
            await tts.click();
            await page.getByText('Voice install request unavailable', { exact: true }).waitFor();
            const retry = page.getByText(label('happyHerd.localVoice.retry'), { exact: true });
            await retry.click();
            await page.getByText(label('happyHerd.localVoice.downloading'), { exact: true }).waitFor();
            await expect.poll(() => page.evaluate(() => (window as any).__VOICE_STATE__.calls.filter((call: any) =>
                call.machineId === 'voice-mac' && call.method === 'happyherd-voice-install' && call.params.feature === 'tts').length)).toBe(2);

            expect(errors).toEqual([]);
            await page.screenshot({ path: `${reportDirectory}/frontend-settings-${viewport.name}.png`, fullPage: true });

            await page.evaluate(() => (window as any).__VOICE_UPDATE__({
                voiceStatus: { stt: { state: 'ready' }, tts: { state: 'ready' } },
                machines: [{ id: 'main-mac', active: true, createdAt: 1, activeAt: 1, metadata: { displayName: 'Main Mac', happyCliVersion: '1.0.0' } }],
            }));
            await page.getByText(label('happyHerd.localVoice.selectedMachineUnavailable'), { exact: true }).waitFor();
            expect(await page.evaluate(() => (window as any).__VOICE_STATE__.localVoiceMachineId)).toBe('voice-mac');
            await page.close();
        });
    }
});
