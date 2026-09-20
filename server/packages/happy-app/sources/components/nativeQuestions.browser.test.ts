import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modules: Record<string, string> = {
    'react-native': `export * from 'react-native-web';`,
    'react-native-unistyles': `import { lightTheme as theme } from '@/theme'; export const StyleSheet = { create: f => typeof f === 'function' ? f(theme) : f, hairlineWidth: 1 }; export const useUnistyles = () => ({ theme });`,
    '@expo/vector-icons': `import React from 'react'; const Icon = ({ name }) => React.createElement('span', { 'data-icon': name }); export const Ionicons = Icon; export const Octicons = Icon;`,
    'expo-router': `export const useRouter = () => ({ push() {} });`,
    '@/text': `import en from '@/text/locales/en.json'; export const t = key => key.split('.').reduce((v, k) => v?.[k], en) ?? key;`,
    '@/components/markdown/MarkdownView': `import React from 'react'; export const MarkdownView = ({ markdown }) => React.createElement('div', null, markdown);`,
    '@/components/CodeView': `import React from 'react'; export const CodeView = ({ code }) => React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, code);`,
    '@/components/tools/knownTools': `export const knownTools = { ExitPlanMode: { input: { safeParse: input => ({ success: true, data: input }) } } }; export const getToolCategoryIcon = () => null;`,
    '@/components/tools/PermissionFooter': `import React from 'react'; export const PermissionFooter = () => React.createElement('div', { 'data-generic-permission': true });`,
    '@/components/tools/views/_all': `
        import { RequestUserInputView } from '@/components/tools/views/RequestUserInputView';
        import { AskUserQuestionView } from '@/components/tools/views/AskUserQuestionView';
        import { ExitPlanToolView } from '@/components/tools/views/ExitPlanToolView';
        import { TodoView } from '@/components/tools/views/TodoView';
        export const getToolViewComponent = name => ({ request_user_input: RequestUserInputView, AskUserQuestion: AskUserQuestionView, CodexPlan: ExitPlanToolView, TodoWrite: TodoView }[name] ?? null);
    `,
    '@/sync/storage': `
        import React from 'react';
        import native from '../../../happy-cli/src/codex/fixtures/native-question.json';
        import { readCodexQuestions } from '@native-question-parser';
        import { selectAgentFormCommunication } from '@/sync/agentCommunications';
        const listeners = new Set();
        const scenario = new URLSearchParams(location.search).get('scenario') ?? 'codex';
        const questions = readCodexQuestions(native.params);
        const communication = { kind: 'form', createdAt: 1, toolUseId: 'call', form: { questions } };
        let state = JSON.parse(localStorage.getItem('receipt') ?? 'null') ?? { communications: { 'native-root': communication } };
        export const getState = () => state;
        export const getScenario = () => scenario;
        export const getNative = () => native;
        export const publish = next => { state = next; localStorage.setItem('receipt', JSON.stringify(state)); listeners.forEach(fn => fn()); };
        function useState() { return React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state); }
        export const useSession = () => ({ active: true, agentState: useState() });
        export const useSessionAgentFormCommunication = (_session, call) => selectAgentFormCommunication(useState(), call);
        export const useSetting = () => true;
        window.__calls = [];
        window.__invalidate = () => publish({ communications: {}, completedCommunications: { 'native-root': { ...communication, status: 'cancelled' } } });
    `,
    '@/sync/ops': `
        import { getState, publish } from '@/sync/storage';
        export const sessionAnswerQuestion = async (session, id, answers, kind) => {
            window.__calls.push({ session, id, answers, kind });
            await new Promise(r => setTimeout(r, 100));
            if (window.__fail) { window.__fail = false; throw new Error('fixture RPC failure'); }
            const state = getState();
            if (!state.communications?.[id]) throw new Error('retired');
            publish({ communications: {}, completedCommunications: { [id]: { ...state.communications[id], status: 'answered', answers } } });
        };
        export const sessionCancelCommunication = async (session, id, kind) => {
            window.__calls.push({ session, id, kind, status: 'cancelled' });
            const state = getState();
            publish({ communications: {}, completedCommunications: { [id]: { ...state.communications[id], status: 'cancelled' } } });
        };
        export const sessionAllow = async (session, id, mode, tools, decision, updatedInput) => {
            window.__calls.push({ session, id, updatedInput });
            publish({ completedRequests: { [id]: { arguments: updatedInput, status: 'approved' } } });
        };
        export const sessionDeny = async () => {};
    `,
};

const plugin: Plugin = {
    name: 'native-question-production-components',
    setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
            let key = args.path;
            if (key.startsWith('.') && args.importer.includes('/sources/')) {
                key = '@/' + resolve(dirname(args.importer), key).slice(resolve(appRoot, 'sources').length + 1);
            }
            if (modules[key]) return { path: key, namespace: 'fixture' };
            if (args.path === '@native-question-parser') return { path: resolve(appRoot, '../happy-cli/src/codex/userInput.ts') };
            if (args.path.includes('happy-cli/src/codex/fixtures')) return { path: resolve(appRoot, '../happy-cli/src/codex/fixtures/native-question.json') };
            if (args.path.startsWith('@/')) {
                const source = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [source + '.web.tsx', source + '.ts', source + '.tsx', source].find(existsSync);
                if (path) return { path };
            }
            return null;
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

describe('native question ToolView browser gestures (synthetic transport)', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    beforeAll(async () => {
        const bundle = await build({
            stdin: { resolveDir: appRoot, loader: 'tsx', contents: `
                import React from 'react'; import { createRoot } from 'react-dom/client';
                import { ToolView } from '@/components/tools/ToolView';
                import { useSession, getScenario, getNative } from '@/sync/storage';
                const native = getNative(); const scenario = getScenario();
                function Host() {
                    const session = useSession();
                    const tool = { callId: 'call', name: 'request_user_input', state: 'running', input: native.params, createdAt: 1, startedAt: 1, completedAt: null };
                    if (scenario === 'claude') {
                        tool.name = 'AskUserQuestion';
                        tool.input = { questions: [{ header: 'Checks', question: 'Which checks?', multiSelect: true, options: [{ label: 'Unit' }, { label: 'Browser' }] }] };
                        tool.permission = { id: 'claude-request', status: session.agentState.completedRequests ? 'approved' : 'pending' };
                    }
                    if (scenario === 'plan') { tool.name = 'CodexPlan'; tool.input = { plan: 'Native plan remains visible in compact mode' }; tool.state = 'completed'; }
                    if (scenario === 'malformed') { tool.name = 'AskUserQuestion'; tool.input = { questions: 'raw unsupported payload' }; tool.permission = { id: 'bad', status: 'pending' }; }
                    return <ToolView tool={tool} metadata={{ flavor: scenario === 'claude' ? 'claude' : 'codex' }} sessionId="session" />;
                }
                createRoot(document.getElementById('root')).render(<Host />);
            ` },
            bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            plugins: [plugin],
        });
        server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<style>body{margin:0}#root{max-width:900px;margin:auto}</style><div id="root"></div><script>globalThis.global=globalThis;${bundle.outputFiles[0].text}</script>`); });
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No fixture port');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE;
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true });
    }, 30000);
    afterAll(async () => { await browser?.close(); await new Promise<void>(done => server ? server.close(() => done()) : done()); });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        it(`answers/retries/restores one native form at ${viewport.width}`, async () => {
            const page = await browser.newPage({ viewport });
            page.setDefaultTimeout(5000);
            await page.goto(origin);
            await page.getByRole('radio', { name: /Project/ }).first().click();
            await page.getByRole('textbox', { name: /Details/ }).fill('Include regressions');
            expect(await page.getByRole('button', { name: /Submit/i }).count()).toBe(1);
            await page.evaluate(() => { (window as any).__fail = true; });
            await page.getByRole('button', { name: /Submit/i }).click();
            await page.getByRole('alert').waitFor();
            expect(await page.getByRole('textbox', { name: /Details/ }).inputValue()).toBe('Include regressions');
            await page.getByRole('button', { name: /Submit/i }).dblclick();
            await page.getByText('Include regressions', { exact: true }).waitFor();
            await expect.poll(() => page.getByRole('button', { name: /Submit/i }).count()).toBe(0);
            const calls = await page.evaluate(() => (window as any).__calls);
            expect(calls).toHaveLength(2);
            expect(calls[1]).toMatchObject({ id: 'native-root', answers: { storage: { options: ['Project'] }, details: { options: [], custom: 'Include regressions' } } });
            await page.reload();
            await page.getByText('Include regressions', { exact: true }).waitFor();
            expect(await page.getByRole('textbox').count()).toBe(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.close();
        }, 20000);

        it(`cancels and invalidates without late actions at ${viewport.width}`, async () => {
            const page = await browser.newPage({ viewport });
            await page.goto(origin);
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.reload();
            await expect.poll(() => page.getByRole('textbox').count()).toBe(0);
            await page.evaluate(() => localStorage.clear());
            await page.reload();
            await page.getByRole('textbox', { name: /Storage/ }).fill('Custom destination');
            await page.evaluate(() => (window as any).__invalidate());
            await expect.poll(() => page.getByRole('button', { name: /Submit/i }).count()).toBe(0);
            expect(await page.evaluate(() => (window as any).__calls.length)).toBe(0);
            await page.close();
        });

        it(`persists Claude multi-select/custom answers and keeps plans/fallback honest at ${viewport.width}`, async () => {
            const page = await browser.newPage({ viewport });
            await page.goto(origin + '?scenario=claude');
            await page.getByRole('checkbox', { name: 'Unit', exact: true }).click();
            await page.getByRole('checkbox', { name: 'Browser', exact: true }).click();
            await page.getByRole('textbox').fill('Native smoke');
            await page.getByRole('button', { name: /Submit/i }).click();
            await page.reload();
            await page.getByText('Unit, Browser, Native smoke', { exact: true }).waitFor();
            expect(await page.getByRole('button', { name: /Submit/i }).count()).toBe(0);
            await page.goto(origin + '?scenario=plan');
            await page.getByText('Native plan remains visible in compact mode', { exact: true }).waitFor();
            await page.goto(origin + '?scenario=malformed');
            await page.getByText(/raw unsupported payload/).waitFor();
            expect(await page.locator('[data-generic-permission]').count()).toBe(1);
            expect(await page.getByRole('textbox').count()).toBe(0);
            await page.close();
        }, 20000);
    }
});
