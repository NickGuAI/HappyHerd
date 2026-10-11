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
        export const StyleSheet = { create: (factory) => typeof factory === 'function' ? factory(lightTheme, {}) : factory, hairlineWidth: 1 };
        export const useUnistyles = () => ({ theme: lightTheme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({ name, size = 16 }) => React.createElement('span', { 'data-icon': name, 'aria-hidden': true, style: { display: 'inline-block', width: size, height: size } });
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/components/StyledText': `import { Text } from 'react-native'; export { Text };`,
    '@/constants/Typography': `export const Typography = { default: () => ({ fontFamily: 'Arial' }), mono: () => ({ fontFamily: 'monospace' }) };`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    './markdown/MarkdownView': `
        import React from 'react';
        import { Text } from 'react-native';
        export const MarkdownView = ({ markdown }) => React.createElement(Text, { 'data-testid': 'chat-reply-body' }, markdown);
    `,
    './tools/ToolView': `export const ToolView = () => null;`,
    './LongPressCopyable': `import React from 'react'; export const LongPressCopyable = ({ children }) => React.createElement(React.Fragment, null, children);`,
    './parseLocalCommandMessage': `export const parseVisibleUserMessage = () => null;`,
    './SafeguardReminderCard': `export const SafeguardReminderCard = () => null;`,
    './CodexQuotaRecoveryActions': `export const CodexQuotaRecoveryActions = () => null;`,
    '@/components/herd/motion': `export const herdWebClasses = () => '';`,
    '@/components/herd/mobile/useHerdPhone': `export const useHerdPhoneLayout = () => false;`,
    '@/utils/userMessageBubbleColor': `export const resolveUserMessageBubbleColor = () => ({ background: 'white', border: 'transparent' });`,
    '@/utils/harnessCatalog': `export const getHarnessName = (provider) => String(provider ?? 'agent');`,
    '@/utils/machineUtils': `export const isMachineOnline = (machine) => Boolean(machine?.active);`,
    '@/sync/typesMessage': `export const isOtherParticipantMessage = () => false;`,
    '@/sync/sync': `export const sync = { sendMessage: async () => {} };`,
    '@/sync/storage': `
        import React from 'react';
        const subscribe = (listener) => { addEventListener('chat-state', listener); return () => removeEventListener('chat-state', listener); };
        export const useSetting = (key) => React.useSyncExternalStore(subscribe, () => globalThis.__CHAT_STATE__[key], () => globalThis.__CHAT_STATE__[key]);
        export const useMachine = (id) => React.useSyncExternalStore(subscribe,
            () => globalThis.__CHAT_STATE__.machines.find((machine) => machine.id === id) ?? null,
            () => globalThis.__CHAT_STATE__.machines.find((machine) => machine.id === id) ?? null);
    `,
    '@/sync/localVoice': `
        const call = (name, ...args) => globalThis.__CHAT_RPC__(name, ...args);
        export const localVoiceStatus = (machineId) => call('status', machineId);
        export const startLocalVoiceSpeech = (machineId, text) => call('speak', machineId, text);
        export const readLocalVoiceAudio = (machineId, operationId, cursor) => call('read', machineId, operationId, cursor);
        export const cancelLocalVoiceOperation = (machineId, operationId) => call('cancel', machineId, operationId);
        export const releaseLocalVoiceOperation = (machineId, operationId) => call('release', machineId, operationId);
    `,
    '@/encryption/base64': `export const decodeBase64 = () => new Uint8Array([1, 2, 3]);`,
    '@/text': `
        import catalog from '@/text/locales/en.json';
        export const t = (key) => key.split('.').reduce((value, part) => value?.[part], catalog) ?? key;
    `,
};

const fixturePlugin: Plugin = {
    name: 'local-voice-chat-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'local-voice-chat-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}.json`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            if (args.path.startsWith('./') && args.importer.startsWith(resolve(appRoot, 'sources'))) {
                const sourcePath = resolve(dirname(args.importer), args.path);
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (path) return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'local-voice-chat-stub' }, (args) => ({
            contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot,
        }));
    },
};

const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { MessageView } from '@/components/MessageView';
    globalThis.__CHAT_STATE__ = {
        localVoiceTtsEnabled: true,
        localVoiceMachineId: 'voice-machine',
        machines: [{ id: 'voice-machine', active: true }],
        voiceStatus: { stt: { state: 'ready' }, tts: { state: 'ready' } },
        calls: [],
        audioCalls: [],
        holdReads: false,
        holdReadsForOperation: null,
        readGate: null,
        operationCount: 0,
    };
    globalThis.__CHAT_UPDATE__ = (patch) => {
        globalThis.__CHAT_STATE__ = { ...globalThis.__CHAT_STATE__, ...patch };
        dispatchEvent(new Event('chat-state'));
    };
    globalThis.__CHAT_RPC__ = async (name, ...args) => {
        const state = globalThis.__CHAT_STATE__;
        state.calls.push({ name, args });
        if (name === 'status') return state.voiceStatus;
        if (name === 'speak') {
            state.operationCount += 1;
            return { operationId: 'speech-' + state.operationCount, kind: 'speak', state: 'running' };
        }
        if (name === 'read') {
            const cursor = args[2];
            if (state.holdReads || state.holdReadsForOperation === args[1]) {
                return await new Promise((resolve) => { state.readGate = resolve; });
            }
            if (cursor === 0) return { state: 'done', nextCursor: 1, chunks: [{ index: 0, audioBase64: 'AQID', mimeType: 'audio/wav', sampleRate: 24000 }] };
            return { state: 'done', nextCursor: cursor, chunks: [] };
        }
        return { ok: true };
    };
    const message = {
        id: 'reply-voice-1', kind: 'agent-text', createdAt: 1, isThinking: false,
        text: '<voice_overview>Short spoken answer.</voice_overview>\\nA longer visible reply body.',
    };
    createRoot(document.getElementById('root')).render(React.createElement(MessageView, {
        message, metadata: { machineId: 'voice-machine', flavor: 'codex' }, sessionId: 'session-1',
    }));
`;

describe('chat local reply playback in a rendered Web host', { timeout: 45_000 }, () => {
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
            response.end(`<style>html,body,#root{height:100%;margin:0;background:#f7efdd}*{box-sizing:border-box}#root{padding:24px}</style><main id="root"></main><script>globalThis.global=globalThis;${script}</script>`);
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
        it(`plays only after a visible chat gesture and exposes a working stop at ${viewport.width}px`, async () => {
            const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
            page.setDefaultTimeout(5_000);
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.addInitScript(() => {
                class FixtureAudioContext {
                    currentTime = 0;
                    destination = {};
                    resume() { (window as any).__CHAT_STATE__.audioCalls.push('resume'); return Promise.resolve(); }
                    close() { (window as any).__CHAT_STATE__.audioCalls.push('close'); return Promise.resolve(); }
                    decodeAudioData() { (window as any).__CHAT_STATE__.audioCalls.push('decode'); return Promise.resolve({ duration: 0 }); }
                    createBufferSource() {
                        return {
                            buffer: null,
                            onended: null,
                            connect() {},
                            start: () => (window as any).__CHAT_STATE__.audioCalls.push('start'),
                            stop: () => (window as any).__CHAT_STATE__.audioCalls.push('stop'),
                        };
                    }
                }
                (window as any).AudioContext = FixtureAudioContext;
            });
            await page.goto(origin);

            const summary = page.getByRole('button', { name: label('happyHerd.localVoice.playSummary') });
            const reply = page.getByRole('button', { name: label('happyHerd.localVoice.playReply') });
            await summary.waitFor();
            await reply.waitFor();
            await page.getByText('A longer visible reply body.', { exact: true }).waitFor();
            await expect.poll(() => page.evaluate(() => (window as any).__CHAT_STATE__.calls.some((call: any) => call.name === 'speak'))).toBe(false);

            await summary.click();
            await expect.poll(() => page.evaluate(() => (window as any).__CHAT_STATE__.calls.some((call: any) => call.name === 'release'))).toBe(true);
            expect(await page.evaluate(() => (window as any).__CHAT_STATE__.calls.filter((call: any) => call.name === 'speak').map((call: any) => call.args[1]))).toEqual(['Short spoken answer.']);
            expect(await page.evaluate(() => (window as any).__CHAT_STATE__.calls.filter((call: any) => call.name === 'read').map((call: any) => call.args[2]))).toEqual([0, 1]);
            expect(await page.evaluate(() => (window as any).__CHAT_STATE__.audioCalls)).toContain('start');
            expect(errors).toEqual([]);

            await page.evaluate(() => { (window as any).__CHAT_STATE__.holdReadsForOperation = 'speech-2'; });
            await reply.click();
            await expect.poll(() => page.evaluate(() => (window as any).__CHAT_STATE__.calls.some((call: any) => call.name === 'read' && call.args[1] === 'speech-2' && call.args[2] === 0))).toBe(true);
            const stop = page.getByRole('button', { name: label('happyHerd.localVoice.stop') });
            await expect.poll(() => page.evaluate(() => Boolean((window as any).__CHAT_STATE__.readGate))).toBe(true);
            await stop.waitFor();
            await stop.click();
            await expect.poll(() => page.evaluate(() => (window as any).__CHAT_STATE__.calls.some((call: any) => call.name === 'cancel' && call.args[1] === 'speech-2'))).toBe(true);

            await page.evaluate(() => (window as any).__CHAT_STATE__.readGate?.({ state: 'done', nextCursor: 1, chunks: [{ index: 0, audioBase64: 'AQID', mimeType: 'audio/wav', sampleRate: 24000 }] }));
            await page.screenshot({ path: `${reportDirectory}/frontend-chat-${viewport.name}.png`, fullPage: true });
            await page.close();
        });
    }
});
