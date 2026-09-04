import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, '../..');
const appRoot = resolve(sourceRoot, '..');

const virtualModules: Record<string, string> = {
    'react-native': `
        import React from 'react';
        import { Animated } from 'react-native-web';
        export * from 'react-native-web';
        export const TurboModuleRegistry = { get: () => null };
        export const useAnimatedValue = (value) => React.useRef(new Animated.Value(value)).current;
    `,
    'react-native-unistyles': `
        const theme = { colors: {
            text: '#111', textSecondary: '#666', divider: '#ddd', surface: '#fff', surfaceHigh: '#eee',
            radio: { active: '#007aff' }, status: { error: '#c22' },
        }};
        export const StyleSheet = {
            hairlineWidth: 1,
            create: (factory) => typeof factory === 'function' ? factory(theme) : factory,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name });
    `,
    '@/auth/AuthContext': `export const useAuth = () => ({ credentials: { token: 'fixture-token', secret: 'fixture-secret' } });`,
    '@/components/StyledText': `export { Text } from 'react-native';`,
    '@/components/ItemGroup': `
        import React from 'react';
        import { View, Text } from 'react-native';
        export const ItemGroup = ({ title, children }) => React.createElement(View, { 'data-item-group': title },
            React.createElement(Text, null, title), children);
    `,
    '@/text': `
        const copy = {
            'usage.today': 'Today', 'usage.last7Days': 'Last 7 days', 'usage.last30Days': 'Last 30 days',
            'usage.reportedTokens': 'Reported Tokens', 'usage.providerCost': 'Provider Cost (USD)',
            'usage.tokens': 'Tokens', 'usage.cost': 'Cost', 'usage.usageOverTime': 'Usage over time',
            'usage.byProvider': 'By Provider', 'usage.noData': 'No usage data available',
            'usage.coverage.title': 'Reporting coverage',
            'usage.coverage.partial': '{provider}: {metric} reporting is partial for this period.',
            'usage.coverage.unavailable': '{provider}: {metric} is not reported by the provider.',
            'usage.coverage.estimated': "{provider}: cost is the provider's per-model estimate, not a billing statement.",
        };
        export const t = (key, values = {}) => Object.entries(values).reduce(
            (text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), copy[key] ?? key);
    `,
    './serverConfig': `export const getServerUrl = () => 'https://api.example.test';`,
    './apiSocket': `export const getHappyClientId = () => 'usage-browser-fixture';`,
};

function fixturePlugin(): Plugin {
    return {
        name: 'usage-panel-fixture',
        setup(buildApi) {
            buildApi.onResolve({ filter: /^(react-native|react-native-unistyles|@expo\/vector-icons|@\/auth\/AuthContext|@\/components\/StyledText|@\/components\/ItemGroup|@\/text)$/ }, (args) => ({ path: args.path, namespace: 'usage-virtual' }));
            buildApi.onResolve({ filter: /^\.\/(serverConfig|apiSocket)$/ }, (args) => ({ path: args.path, namespace: 'usage-virtual' }));
            buildApi.onResolve({ filter: /^@\// }, (args) => {
                const sourcePath = resolve(sourceRoot, args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (!path) throw new Error(`missing usage fixture source: ${args.path}`);
                return { path };
            });
            buildApi.onLoad({ filter: /.*/, namespace: 'usage-virtual' }, (args) => ({
                contents: virtualModules[args.path],
                loader: 'js',
                resolveDir: appRoot,
            }));
        },
    };
}

function recordPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    return errors;
}

describe('UsagePanel browser behavior', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/UsagePanel.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            plugins: [fixturePlugin()],
        });
        const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<main id="root"></main><script>${script}</script>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Usage fixture did not bind');
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

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ])('renders reconciled totals and named gaps on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        const errors = recordPageErrors(page);
        await page.goto(origin);

        await expect(page.getByText('350', { exact: true }).first().waitFor()).resolves.toBeUndefined();
        await expect(page.getByText('$0.1200', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('By Provider', { exact: true }).count()).resolves.toBe(1);
        for (const provider of ['claude', 'codex', 'grok']) {
            await expect(page.getByText(provider, { exact: true }).count()).resolves.toBe(1);
        }
        await expect(page.getByText("claude: cost is the provider's per-model estimate, not a billing statement.", { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('codex: Cost is not reported by the provider.', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('dsh: Tokens is not reported by the provider.', { exact: true }).count()).resolves.toBe(1);

        await page.getByText('Cost', { exact: true }).click();
        await page.getByText('Today', { exact: true }).click();
        await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __USAGE_REQUESTS__: unknown[] }).__USAGE_REQUESTS__.length)).toBe(2);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);
});
