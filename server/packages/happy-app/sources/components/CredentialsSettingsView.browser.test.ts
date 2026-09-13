import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

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
        const dark = globalThis.__DARK__;
        const theme = {
            colors: {
                divider: dark ? '#383838' : '#ddd',
                surface: dark ? '#222' : '#fff',
                surfacePressedOverlay: dark ? '#333' : '#eee',
                surfaceRipple: dark ? '#333' : '#eee',
                text: dark ? '#f5f5f5' : '#111',
                textSecondary: dark ? '#aaa' : '#666',
                textDestructive: '#d33',
                header: { tint: '#0aa7d1' },
                glass: { divider: dark ? '#444' : '#ddd' },
                groupped: {
                    background: dark ? '#181818' : '#f5f5f5',
                    chevron: '#777',
                    sectionTitle: dark ? '#aaa' : '#666',
                },
                shadow: { color: '#000', opacity: 0.1 },
            },
        };
        export const StyleSheet = {
            create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory,
            hairlineWidth: 1,
        };
        export const useUnistyles = () => ({ theme });
    `,
    'react-native-reanimated': `
        import React from 'react';
        const Animated = { createAnimatedComponent: (component) => component };
        export default Animated;
        export const cancelAnimation = () => {};
        export const Easing = { out: (value) => value, quad: 'quad' };
        export const useAnimatedStyle = (factory) => factory();
        export const useSharedValue = (value) => React.useRef({ value }).current;
        export const withSpring = (value) => value;
        export const withTiming = (value) => value;
    `,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name });
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/auth/AuthContext': `
        const credentials = { token: 'test-token', secret: 'test-secret' };
        export const useAuth = () => ({ credentials });
    `,
    '@/components/ProviderIcon': `
        import React from 'react';
        export const ProviderIcon = ({ kind }) => React.createElement('span', { 'data-provider': kind });
    `,
    '@/components/StyledText': `import { Text as NativeText } from 'react-native'; export const Text = NativeText;`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    '@/constants/Typography': `export const Typography = { default: () => ({}) };`,
    '@/modal': `
        export const Modal = {
            alert() {},
            prompt: async () => undefined,
            confirm: async () => globalThis.__CONFIRM__ !== false,
        };
    `,
    '@/sync/storage': `
        import React from 'react';
        export const useAllMachines = () => {
            const [machines, setMachines] = React.useState(globalThis.__FIXTURE_STATE__.machines);
            React.useEffect(() => {
                globalThis.__SET_MACHINES__ = (next) => {
                    globalThis.__FIXTURE_STATE__.machines = next;
                    setMachines(next);
                };
                return () => { delete globalThis.__SET_MACHINES__; };
            }, []);
            return machines;
        };
    `,
    '@/sync/machineChoices': `export const getMachineName = (machine) => machine.metadata.displayName ?? machine.metadata.host;`,
    '@/utils/machineUtils': `export const isMachineOnline = (machine) => machine.active;`,
    '@/utils/sessionUtils': `export const formatLastSeen = () => 'recently';`,
    '@/utils/openExternalUrl': `
        export const openExternalUrl = async (url) => {
            globalThis.__FIXTURE_STATE__.opened.push(url);
        };
    `,
    '@/sync/apiCredentials': `
        const state = () => globalThis.__FIXTURE_STATE__;
        export class CredentialApiError extends Error {
            constructor(status, message, code = null) {
                super(message);
                this.name = 'CredentialApiError';
                this.status = status;
                this.code = code;
            }
        }
        export const listSavedCredentials = async () => {
            state().calls.push(['credential-list']);
            if (state().scenario === 'error') throw new Error('Credential service unavailable');
            return state().credentials.map(({ secret, ...item }) => ({ ...item }));
        };
        export const saveCredential = async (_auth, input) => {
            state().calls.push(['credential-save', { ...input, secret: input.secret ? '[redacted]' : undefined }]);
            if (state().scenario === 'deferred-credential-save') {
                await state().credentialSaveGate;
                state().credentialSaveResolutions += 1;
            }
            if (state().scenario === 'long-credential-name-conflict') {
                throw new CredentialApiError(
                    409,
                    'A saved credential with this name already exists',
                    'saved-credential-name-conflict',
                );
            }
            if (input.id) {
                const index = state().credentials.findIndex((item) => item.id === input.id);
                if (state().scenario === 'credential-conflict' && !state().credentialConflictRaised) {
                    state().credentialConflictRaised = true;
                    const existing = state().credentials[index];
                    state().credentials[index] = {
                        ...existing,
                        name: 'Server-updated token',
                        version: existing.version + 1,
                        updatedAt: Date.now(),
                    };
                    throw new CredentialApiError(
                        409,
                        'Saved credential changed',
                        'saved-credential-version-conflict',
                    );
                }
                if (state().scenario === 'credential-name-conflict') {
                    throw new CredentialApiError(
                        409,
                        'A saved credential with this name already exists',
                        'saved-credential-name-conflict',
                    );
                }
                if (state().credentials[index].version !== input.expectedVersion) {
                    throw new CredentialApiError(
                        409,
                        'Saved credential changed',
                        'saved-credential-version-conflict',
                    );
                }
                const old = state().credentials[index];
                state().credentials[index] = {
                    ...old, ...input, version: old.version + 1, updatedAt: Date.now(),
                    secret: input.secret || old.secret,
                };
                return (({ secret, ...safe }) => safe)(state().credentials[index]);
            }
            if (state().scenario === 'credential-limit') {
                throw new CredentialApiError(
                    409,
                    'Saved credential limit reached',
                    'saved-credential-limit-reached',
                );
            }
            const item = { ...input, id: 'credential-' + (state().credentials.length + 1), version: 0, createdAt: Date.now(), updatedAt: Date.now() };
            state().credentials.push(item);
            return (({ secret, ...safe }) => safe)(item);
        };
        export const revealSavedCredential = async (_auth, id) => {
            state().calls.push(['credential-reveal', id]);
            if (state().scenario === 'long-credential-reveal-error') throw new Error('Reveal unavailable');
            const item = state().credentials.find((candidate) => candidate.id === id);
            if (!item) throw new Error('Not found');
            return { id, secret: item.secret };
        };
        export const deleteSavedCredential = async (_auth, id) => {
            state().calls.push(['credential-delete', id]);
            if (state().scenario === 'long-credential-delete-error') throw new Error('Delete unavailable');
            state().credentials = state().credentials.filter((item) => item.id !== id);
        };
    `,
    '@/sync/credentialOps': `
        const state = () => globalThis.__FIXTURE_STATE__;
        const safeAccounts = (machineId) => (
            state().accountsByMachine?.[machineId] ?? state().accounts
        ).map((item) => ({ ...item }));
        export const listManagedCredentialAccounts = async (machineId) => {
            state().calls.push(['account-list', machineId]);
            if (state().scenario === 'error') throw new Error('Machine request failed');
            return safeAccounts(machineId);
        };
        export const useManagedCredentialAccount = async (machineId, target) => {
            state().calls.push(['account-use', machineId, target]);
            if (state().scenario === 'long-account-mutation-error') {
                throw new Error('Account update unavailable');
            }
            if (state().scenario === 'stale-account-mutation' && !state().staleAccountRaised) {
                state().staleAccountRaised = true;
                state().accounts = state().accounts.map((item) => (
                    item.id === target.id
                        ? { ...item, credentialVersion: item.credentialVersion + 1 }
                        : item
                ));
                throw new Error('This provider account changed. Refresh accounts and retry');
            }
            if (
                ['deferred-mutation', 'heartbeat-during-mutation'].includes(state().scenario)
                && machineId === 'machine-1'
            ) {
                await state().mutationGate;
            }
            const next = safeAccounts(machineId).map((item) => ({
                ...item,
                current: item.provider === target.provider ? item.id === target.id : item.current,
            }));
            if (state().accountsByMachine) state().accountsByMachine[machineId] = next;
            else state().accounts = next;
            return safeAccounts(machineId);
        };
        export const renameManagedCredentialAccount = async (machineId, target) => {
            state().calls.push(['account-rename', machineId, target]);
            if (state().scenario === 'deferred-rename' && machineId === 'machine-1') {
                await state().mutationGate;
            }
            const next = safeAccounts(machineId).map((item) => (
                item.id === target.id && item.credentialVersion === target.expectedCredentialVersion
                    ? { ...item, name: target.newName }
                    : item
            ));
            if (state().accountsByMachine) state().accountsByMachine[machineId] = next;
            else state().accounts = next;
            return safeAccounts(machineId);
        };
        export const removeManagedCredentialAccount = async (machineId, target) => {
            state().calls.push(['account-remove', machineId, target]);
            if (state().scenario === 'deferred-remove' && machineId === 'machine-1') {
                await state().mutationGate;
            }
            const next = safeAccounts(machineId).filter((item) => (
                item.id !== target.id || item.credentialVersion !== target.expectedCredentialVersion
            ));
            if (state().accountsByMachine) state().accountsByMachine[machineId] = next;
            else state().accounts = next;
            return safeAccounts(machineId);
        };
        export const startManagedCredentialLogin = async (machineId, target) => {
            state().calls.push(['login-start', machineId, target]);
            state().loginPolls = 0;
            if (state().scenario === 'stale-account-relogin' && !state().staleReloginRaised) {
                state().staleReloginRaised = true;
                state().accounts = state().accounts.map((item) => (
                    item.id === target.id
                        ? { ...item, credentialVersion: item.credentialVersion + 1 }
                        : item
                ));
                throw new Error('This provider account changed. Refresh accounts and retry');
            }
            if (state().scenario === 'deferred-account-login-error') {
                await state().loginGate;
                throw new Error('Provider login unavailable');
            }
            if (state().scenario === 'long-account-login-error') {
                throw new Error('Provider login unavailable');
            }
            if (state().scenario === 'deferred-login' && machineId === 'machine-1') {
                await state().loginGate;
            }
            return {
                id: 'flow-1', ...target, state: 'waiting-user',
                verificationUrl: target.provider === 'grok' ? 'https://accounts.x.ai/device' : 'https://claude.com/oauth',
                userCode: target.provider === 'grok' ? 'ABCD-EFGH' : undefined,
                requiresCodeEntry: target.provider === 'claude',
                expiresAt: Date.now() + 60000,
            };
        };
        export const getManagedCredentialLogin = async (_machineId, _id) => {
            state().loginPolls += 1;
            if (state().scenario === 'poll-retry' && state().loginPolls === 1) {
                throw new Error('Temporary status failure');
            }
            if (state().failNextLogin) {
                state().failNextLogin = false;
                const call = [...state().calls].reverse().find((entry) => entry[0] === 'login-start');
                const target = call?.[2] ?? { provider: 'grok', name: 'added' };
                return {
                    id: 'flow-1', ...target, state: 'failed', requiresCodeEntry: false,
                    error: 'Provider denied the login.', expiresAt: Date.now() + 60000,
                };
            }
            if (state().loginPolls < 2) return {
                id: 'flow-1', provider: state().lastLoginProvider ?? 'grok', name: state().lastLoginName ?? 'added',
                state: 'waiting-user', verificationUrl: 'https://accounts.x.ai/device',
                userCode: 'ABCD-EFGH', requiresCodeEntry: false, expiresAt: Date.now() + 60000,
            };
            const call = [...state().calls].reverse().find((entry) => entry[0] === 'login-start');
            const target = call[2];
            if (!state().accounts.some((item) => item.provider === target.provider && item.name === target.name)) {
                state().accounts.push({
                    id: '44444444-4444-4444-8444-444444444444', credentialVersion: 1,
                    provider: target.provider, name: target.name, status: 'stored', current: true, limitedUntil: null,
                    createdAt: Date.now(), updatedAt: Date.now(),
                });
            }
            return { id: 'flow-1', ...target, state: 'succeeded', requiresCodeEntry: false, expiresAt: Date.now() + 60000 };
        };
        export const submitManagedCredentialLoginCode = async (machineId, id, code) => {
            state().calls.push(['login-submit', machineId, id, code]);
            if (state().scenario === 'deferred-submit') await state().submitGate;
            const call = [...state().calls].reverse().find((entry) => entry[0] === 'login-start');
            const target = call?.[2] ?? { provider: 'claude', name: 'added' };
            return { id, ...target, state: 'starting', requiresCodeEntry: true, expiresAt: Date.now() + 60000 };
        };
        export const cancelManagedCredentialLogin = async (machineId, id) => {
            state().calls.push(['login-cancel', machineId, id]);
            const call = [...state().calls].reverse().find((entry) => entry[0] === 'login-start');
            const target = call?.[2] ?? { provider: 'grok', name: 'added' };
            return {
                id, ...target, state: 'canceled', requiresCodeEntry: false, expiresAt: Date.now() + 60000,
            };
        };
    `,
    '@/text': `
        const labels = {
            'settingsCredentials.title': 'Credentials & Accounts',
            'settingsCredentials.subtitle': 'Manage connected providers and saved credentials',
            'settingsCredentials.machine': 'Machine',
            'settingsCredentials.machineScope': 'Accounts are stored on the selected machine',
            'settingsCredentials.machineOffline': 'This machine is offline',
            'settingsCredentials.machineUnsupported': 'Update and restart HappyHerd on this machine to manage accounts',
            'settingsCredentials.providerAccounts': 'Provider Accounts',
            'settingsCredentials.savedCredentials': 'Saved Credentials',
            'settingsCredentials.stored': 'Stored',
            'settingsCredentials.default': 'Default',
            'settingsCredentials.limitedUntil': 'Limited until {time}',
            'settingsCredentials.addAccount': 'Add Account',
            'settingsCredentials.login': 'Log In',
            'settingsCredentials.relogin': 'Log In Again',
            'settingsCredentials.loginPending': 'Waiting for provider login',
            'settingsCredentials.loginSuccess': 'Account saved',
            'settingsCredentials.loginFailed': 'Login failed',
            'settingsCredentials.loginCanceled': 'Login canceled',
            'settingsCredentials.loginExpired': 'Login request expired',
            'settingsCredentials.cancelLogin': 'Cancel Login',
            'settingsCredentials.setDefault': 'Set as Default',
            'settingsCredentials.rename': 'Rename',
            'settingsCredentials.removeLocal': 'Remove from Machine',
            'settingsCredentials.removeLocalTitle': 'Remove Account?',
            'settingsCredentials.removeLocalMessage': 'Remove {name} from {provider}',
            'settingsCredentials.accountNickname': 'Nickname',
            'settingsCredentials.accountNicknamePlaceholder': 'Work',
            'settingsCredentials.provider': 'Provider',
            'settingsCredentials.openProvider': 'Open {provider}',
            'settingsCredentials.verificationCode': 'Verification Code',
            'settingsCredentials.submitCode': 'Submit Code',
            'settingsCredentials.credentialName': 'Name',
            'settingsCredentials.credentialType': 'Type',
            'settingsCredentials.service': 'Service',
            'settingsCredentials.servicePlaceholder': 'api.example.com',
            'settingsCredentials.username': 'Username',
            'settingsCredentials.secret': 'Secret',
            'settingsCredentials.usage': 'Usage Labels',
            'settingsCredentials.typeLogin': 'Username & Password',
            'settingsCredentials.typeToken': 'Token',
            'settingsCredentials.typeConnection': 'Connection',
            'settingsCredentials.usageSkills': 'Skills',
            'settingsCredentials.usageBrowser': 'Browser',
            'settingsCredentials.usageMcp': 'MCP',
            'settingsCredentials.showSecret': 'Show Secret',
            'settingsCredentials.hideSecret': 'Hide Secret',
            'settingsCredentials.keepExistingSecret': 'Leave blank to keep the existing secret',
            'settingsCredentials.addCredential': 'Add Credential',
            'settingsCredentials.editCredential': 'Edit Credential',
            'settingsCredentials.deleteCredential': 'Delete Credential',
            'settingsCredentials.deleteCredentialTitle': 'Delete Credential?',
            'settingsCredentials.deleteCredentialMessage': 'Delete {name}?',
            'settingsCredentials.loading': 'Loading…',
            'settingsCredentials.emptyAccounts': 'No provider accounts on this machine',
            'settingsCredentials.emptyCredentials': 'No saved credentials',
            'settingsCredentials.retry': 'Retry',
            'settingsCredentials.reload': 'Reload',
            'settingsCredentials.save': 'Save',
            'settingsCredentials.cancel': 'Cancel',
            'settingsCredentials.saveFailed': 'Could not save',
            'settingsCredentials.loadFailed': 'Could not load credentials',
            'settingsCredentials.noMachines': 'No machines available',
            'settingsCredentials.selectMachine': 'Select a Machine',
            'settingsCredentials.accountHelp': 'Local account help',
            'settingsCredentials.credentialHelp': 'Encrypted server credential help',
            'settingsCredentials.credentialChanged': 'The saved credential has been changed elsewhere. You must reload before editing again.',
            'settingsCredentials.required': 'Required',
            'status.online': 'Online',
            'status.lastSeen': 'Last seen {time}',
        };
        export const t = (key, params = {}) => Object.entries(params).reduce(
            (value, [name, replacement]) => value.replaceAll('{' + name + '}', String(replacement)),
            labels[key] ?? key,
        );
    `,
};

const fixturePlugin: Plugin = {
    name: 'credential-settings-browser-fixture',
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

function recordErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

describe('CredentialsSettingsView browser journeys', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import { CredentialsSettingsView } from '@/components/CredentialsSettingsView';
                    const query = new URLSearchParams(location.search);
                    const scenario = query.get('scenario') ?? 'populated';
                    const hasSecondMachine = scenario.startsWith('deferred-');
                    const active = scenario !== 'offline';
                    const protocol = scenario === 'unsupported' ? undefined : 1;
                    globalThis.__DARK__ = query.get('theme') === 'dark';
                    globalThis.__CONFIRM__ = true;
                    let releaseMutation;
                    let releaseLogin;
                    let releaseSubmit;
                    let releaseCredentialSave;
                    const mutationGate = new Promise((resolve) => { releaseMutation = resolve; });
                    const loginGate = new Promise((resolve) => { releaseLogin = resolve; });
                    const submitGate = new Promise((resolve) => { releaseSubmit = resolve; });
                    const credentialSaveGate = new Promise((resolve) => { releaseCredentialSave = resolve; });
                    const primaryAccounts = scenario === 'empty' ? []
                        : scenario.startsWith('long-account-')
                            ? Array.from({ length: 100 }, (_, index) => ({
                                id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
                                credentialVersion: 1, provider: 'codex', name: 'Provider account ' + (index + 1),
                                status: 'stored', current: index === 0, limitedUntil: null,
                                createdAt: index + 1, updatedAt: index + 2,
                            }))
                            : [
                                {
                                    id: '11111111-1111-4111-8111-111111111111', credentialVersion: 1,
                                    provider: 'claude', name: 'work', status: 'stored', current: true,
                                    limitedUntil: null, createdAt: 1, updatedAt: 2,
                                },
                                {
                                    id: '22222222-2222-4222-8222-222222222222', credentialVersion: 1,
                                    provider: 'codex', name: 'personal', status: 'stored', current: false,
                                    limitedUntil: null, createdAt: 1, updatedAt: 2,
                                },
                            ];
                    const initialCredentials = scenario === 'empty' ? []
                        : scenario.startsWith('long-credential-')
                            ? Array.from({ length: 200 }, (_, index) => ({
                                id: 'credential-' + (index + 1),
                                name: index === 0 ? 'Demo token' : 'Saved credential ' + (index + 1),
                                type: 'token', service: 'api.example.test', username: 'demo-user',
                                usage: ['skills', 'mcp'], version: 0,
                                createdAt: index + 1, updatedAt: index + 2, secret: 'fixture-secret-value',
                            }))
                            : [{
                                id: 'credential-1', name: 'Demo token', type: 'token', service: 'api.example.test',
                                username: 'demo-user', usage: ['skills', 'mcp'], version: 0,
                                createdAt: 1, updatedAt: 2, secret: 'fixture-secret-value',
                            }];
                    globalThis.__FIXTURE_STATE__ = {
                        scenario,
                        calls: [],
                        opened: [],
                        loginPolls: 0,
                        failNextLogin: scenario === 'login-failure',
                        staleAccountRaised: false,
                        staleReloginRaised: false,
                        credentialConflictRaised: false,
                        credentialSaveResolutions: 0,
                        mutationGate, releaseMutation,
                        loginGate, releaseLogin,
                        submitGate, releaseSubmit,
                        credentialSaveGate, releaseCredentialSave,
                        machines: scenario === 'none' ? [] : [
                            {
                                id: 'machine-1', active, activeAt: Date.now(),
                                metadata: { host: 'Studio', displayName: 'Studio', credentialManagementProtocolVersion: protocol },
                            },
                            ...(hasSecondMachine ? [{
                                id: 'machine-2', active: true, activeAt: Date.now() - 1,
                                metadata: { host: 'Laptop', displayName: 'Laptop', credentialManagementProtocolVersion: 1 },
                            }] : []),
                        ],
                        accounts: primaryAccounts,
                        accountsByMachine: hasSecondMachine ? {
                            'machine-1': primaryAccounts,
                            'machine-2': [{
                                id: '33333333-3333-4333-8333-333333333333', credentialVersion: 1,
                                provider: 'claude', name: 'laptop-only', status: 'stored', current: true,
                                limitedUntil: null, createdAt: 1, updatedAt: 2,
                            }],
                        } : undefined,
                        credentials: initialCredentials,
                    };
                    const host = document.getElementById('root');
                    let root = createRoot(host);
                    const render = () => root.render(React.createElement(CredentialsSettingsView));
                    globalThis.__ROOT__ = root;
                    globalThis.__REMOUNT__ = () => {
                        root.unmount();
                        root = createRoot(host);
                        globalThis.__ROOT__ = root;
                        render();
                    };
                    render();
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
        server = createServer((request, response) => {
            const dark = request.url?.includes('theme=dark');
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body{min-height:100%;margin:0;background:${dark ? '#181818' : '#f5f5f5'};color:${dark ? '#f5f5f5' : '#111'};font-family:system-ui}header{height:56px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;border-bottom:1px solid ${dark ? '#383838' : '#ddd'}}#root{min-height:calc(100% - 57px)}</style><header>Credentials &amp; Accounts</header><main id="root"></main><script>globalThis.__DARK__=${Boolean(dark)};globalThis.global=globalThis;${script}</script>`);
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

    it.each([
        ['desktop light', { width: 1440, height: 900 }, 'light'],
        ['desktop dark', { width: 1440, height: 900 }, 'dark'],
        ['mobile light', { width: 390, height: 844 }, 'light'],
        ['mobile dark', { width: 390, height: 844 }, 'dark'],
        ['compact mobile light', { width: 360, height: 800 }, 'light'],
        ['compact mobile dark', { width: 360, height: 800 }, 'dark'],
    ] as const)('renders the real page responsively on %s', async (label, viewport, theme) => {
        const page = await browser.newPage({ viewport });
        const errors = recordErrors(page);
        await page.goto(`${origin}/?theme=${theme}`);
        await page.getByText('Credentials & Accounts', { exact: true }).waitFor();
        await expect(page.getByText('Credentials & Accounts', { exact: true }).count()).resolves.toBe(1);
        await page.getByText('Demo token', { exact: true }).waitFor();
        for (const name of ['Add Account', 'work', 'personal', 'Add Credential', 'Demo token']) {
            await expect(page.getByRole('button', { name: new RegExp(name) }).count()).resolves.toBe(1);
        }
        expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
        expect(await page.locator('body').innerText()).not.toContain('fixture-secret-value');
        if (viewport.width <= 390) {
            await page.getByRole('button', { name: 'Add Credential', exact: true }).click();
            const inputFontSizes = await page.locator('input').evaluateAll((inputs) => (
                inputs.map((input) => Number.parseFloat(getComputedStyle(input).fontSize))
            ));
            expect(inputFontSizes.length).toBeGreaterThan(0);
            for (const fontSize of inputFontSizes) expect(fontSize).toBeGreaterThanOrEqual(16);
        }
        const controls = page.locator('input,[role="button"]');
        for (let index = 0; index < await controls.count(); index++) {
            const box = await controls.nth(index).boundingBox();
            if (box) expect(box.height).toBeGreaterThanOrEqual(44);
        }
        const evidenceDir = process.env.HAPPYHERD_UI_EVIDENCE_DIR?.trim();
        if (evidenceDir) {
            await mkdir(evidenceDir, { recursive: true });
            await page.screenshot({
                path: resolve(evidenceDir, `${label.replaceAll(' ', '-')}.png`),
                fullPage: true,
            });
        }
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('reveals only on demand and clears plaintext when the row collapses', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = recordErrors(page);
        await page.goto(origin);
        await page.getByText('Demo token', { exact: true }).click();
        await page.getByRole('button', { name: 'Show Secret', exact: true }).click();
        await page.getByText('fixture-secret-value', { exact: true }).waitFor({ timeout: 2_000 });
        await page.getByText('Demo token', { exact: true }).click();
        await expect(page.getByText('fixture-secret-value', { exact: true }).count()).resolves.toBe(0);
        const calls = await page.evaluate(() => (window as any).__FIXTURE_STATE__.calls);
        expect(calls).toContainEqual(['credential-reveal', 'credential-1']);
        expect(errors).toEqual([]);
        await page.close();
    });

    it('keeps a long-list save error beside the editable draft on mobile', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=long-credential-name-conflict`);
        await page.getByRole('button', { name: 'Add Credential', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).fill('Preserved mobile draft');
        await page.getByLabel('Secret', { exact: true }).fill('draft-secret');
        await page.getByRole('button', { name: 'Save', exact: true }).click();

        const error = page.getByText('A saved credential with this name already exists', { exact: true });
        await error.waitFor();
        expect(await error.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.top < window.innerHeight && box.bottom > 0;
        })).toBe(true);
        await expect(page.getByLabel('Name', { exact: true }).inputValue()).resolves.toBe('Preserved mobile draft');
        await expect(page.getByLabel('Name', { exact: true }).isEditable()).resolves.toBe(true);
        await page.close();
    });

    it.each([
        ['reveal', 'long-credential-reveal-error', 'Show Secret', 'Reveal unavailable'],
        ['delete', 'long-credential-delete-error', 'Delete Credential', 'Delete unavailable'],
    ] as const)('keeps a lower-row %s error and retry action visible on mobile', async (
        _operation,
        scenario,
        action,
        message,
    ) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=${scenario}`);
        await page.getByRole('button', { name: /Saved credential 200/ }).click();
        await page.getByRole('button', { name: action, exact: true }).click();

        const error = page.getByText(message, { exact: true });
        await error.waitFor();
        expect(await error.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.top < window.innerHeight && box.bottom > 0;
        })).toBe(true);
        await expect(page.getByRole('button', { name: action, exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('persists a credential through the authenticated transport boundary', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=empty`);
        await page.getByText('Add Credential', { exact: true }).dispatchEvent('click');
        await page.getByLabel('Name', { exact: true }).fill('Build token', { timeout: 2_000 });
        await page.getByLabel('Service').fill('build.example.test', { timeout: 2_000 });
        await page.getByLabel('Secret').fill('new-secret', { timeout: 2_000 });
        await page.getByRole('button', { name: 'MCP', exact: true }).click();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.getByText('Build token', { exact: true }).waitFor({ timeout: 2_000 });
        expect(await page.locator('body').innerText()).not.toContain('new-secret');
        const calls = await page.evaluate(() => (window as any).__FIXTURE_STATE__.calls);
        expect(calls).toContainEqual(['credential-save', expect.objectContaining({
            name: 'Build token',
            secret: '[redacted]',
            usage: ['skills', 'mcp'],
        })]);
        await page.close();
    });

    it('locks every credential draft and list mutation while a save is pending', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=deferred-credential-save`);
        await page.getByRole('button', { name: /Demo token/ }).click();
        await page.getByRole('button', { name: 'Edit Credential', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).fill('Pending token');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-save').length
        ))).toBe(1);

        await expect(page.getByLabel('Name', { exact: true }).isEditable()).resolves.toBe(false);
        for (const control of [
            page.getByRole('button', { name: 'Add Credential', exact: true }),
            page.getByRole('button', { name: /Demo token/ }),
            page.getByRole('button', { name: 'Token', exact: true }),
            page.getByRole('button', { name: 'Skills', exact: true }),
            page.getByRole('button', { name: 'Save', exact: true }),
            page.getByRole('button', { name: 'Cancel', exact: true }),
        ]) {
            await expect(control.isDisabled()).resolves.toBe(true);
        }

        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseCredentialSave());
        await page.getByText('Pending token', { exact: true }).waitFor();
        await expect(page.getByRole('button', { name: 'Add Credential', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('ignores a deferred credential save completion after the view unmounts', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=deferred-credential-save`);
        await page.getByRole('button', { name: /Demo token/ }).click();
        await page.getByRole('button', { name: 'Edit Credential', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).fill('Late token');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-save').length
        ))).toBe(1);
        const initialListCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-list').length
        ));

        await page.evaluate(() => (window as any).__ROOT__.unmount());
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseCredentialSave());
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.credentialSaveResolutions
        ))).toBe(1);
        const finalListCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-list').length
        ));
        expect(finalListCalls).toBe(initialListCalls);
        await page.close();
    });

    it('offers a visible reload path after a version conflict', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=credential-conflict`);
        await page.getByRole('button', { name: /Demo token/ }).click();
        await page.getByRole('button', { name: 'Edit Credential', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).fill('Local edit');
        await page.getByRole('button', { name: 'Save', exact: true }).click();

        await page.getByText(
            'The saved credential has been changed elsewhere. You must reload before editing again.',
            { exact: true },
        ).waitFor();
        await expect(page.getByLabel('Name', { exact: true }).isEditable()).resolves.toBe(false);
        await page.getByRole('button', { name: /Reload/ }).click();
        await page.getByText('Server-updated token', { exact: true }).waitFor();
        await expect(page.getByLabel('Name', { exact: true }).count()).resolves.toBe(0);
        const listCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-list').length
        ));
        expect(listCalls).toBeGreaterThanOrEqual(2);
        await page.close();
    });

    it.each([
        [
            'credential-name-conflict',
            'A saved credential with this name already exists',
            true,
        ],
        [
            'credential-limit',
            'Saved credential limit reached',
            false,
        ],
    ] as const)('preserves an editable draft after %s', async (scenario, message, editExisting) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=${scenario}`);
        if (editExisting) {
            await page.getByRole('button', { name: /Demo token/ }).click();
            await page.getByRole('button', { name: 'Edit Credential', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Add Credential', exact: true }).click();
            await page.getByLabel('Secret', { exact: true }).fill('draft-secret');
        }
        await page.getByLabel('Name', { exact: true }).fill('Preserved draft');
        await page.getByRole('button', { name: 'Save', exact: true }).click();

        await page.getByText(message, { exact: true }).waitFor();
        await expect(page.getByLabel('Name', { exact: true }).inputValue()).resolves.toBe('Preserved draft');
        await expect(page.getByLabel('Name', { exact: true }).isEditable()).resolves.toBe(true);
        await expect(page.getByRole('button', { name: 'Save', exact: true }).isDisabled()).resolves.toBe(false);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-save').length
        ))).toBe(2);
        await page.close();
    });

    it('uses confirmed local removal and leaves cancellation untouched', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(origin);
        await page.getByText('personal', { exact: true }).click();
        await page.evaluate(() => { (window as any).__CONFIRM__ = false; });
        await page.getByRole('button', { name: 'Remove from Machine', exact: true }).click();
        await expect(page.getByText('personal', { exact: true }).count()).resolves.toBe(1);
        await page.evaluate(() => { (window as any).__CONFIRM__ = true; });
        await page.getByRole('button', { name: 'Remove from Machine', exact: true }).click();
        await expect.poll(() => page.getByText('personal', { exact: true }).count()).toBe(0);
        const calls = await page.evaluate(() => (window as any).__FIXTURE_STATE__.calls);
        expect(calls).toContainEqual(['account-remove', 'machine-1', {
            id: '22222222-2222-4222-8222-222222222222',
            provider: 'codex',
            name: 'personal',
            expectedCredentialVersion: 1,
        }]);
        await page.close();
    });

    it('sends the selected account identity when logging in again', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(origin);
        await page.getByRole('button', { name: /work/ }).click();
        await page.getByRole('button', { name: 'Log In Again', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-start').length
        ))).toBe(1);
        const calls = await page.evaluate(() => (window as any).__FIXTURE_STATE__.calls);
        expect(calls).toContainEqual(['login-start', 'machine-1', {
            id: '11111111-1111-4111-8111-111111111111',
            provider: 'claude',
            name: 'work',
            expectedCredentialVersion: 1,
        }]);
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-start').length
        ))).toBe(2);
        const retryTargets = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls
                .filter((call: unknown[]) => call[0] === 'login-start')
                .map((call: unknown[]) => call[2])
        ));
        expect(retryTargets).toEqual([
            {
                id: '11111111-1111-4111-8111-111111111111',
                provider: 'claude',
                name: 'work',
                expectedCredentialVersion: 1,
            },
            {
                id: '11111111-1111-4111-8111-111111111111',
                provider: 'claude',
                name: 'work',
                expectedCredentialVersion: 1,
            },
        ]);
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.close();
    });

    it('persists default selection and account rename through a component remount', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(origin);
        await page.getByText('personal', { exact: true }).click();
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.accounts.find((account: any) => account.name === 'personal')?.current
        ))).toBe(true);
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('personal-renamed');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.getByText('personal-renamed', { exact: true }).waitFor();

        await page.evaluate(() => (window as any).__REMOUNT__());
        await page.getByText('personal-renamed', { exact: true }).waitFor();
        const state = await page.evaluate(() => (window as any).__FIXTURE_STATE__);
        expect(state.calls).toContainEqual(['account-use', 'machine-1', {
            id: '22222222-2222-4222-8222-222222222222',
            provider: 'codex',
            name: 'personal',
            expectedCredentialVersion: 1,
        }]);
        expect(state.calls).toContainEqual(['account-rename', 'machine-1', {
            id: '22222222-2222-4222-8222-222222222222',
            provider: 'codex',
            name: 'personal',
            expectedCredentialVersion: 1,
            newName: 'personal-renamed',
        }]);
        await page.close();
    });

    it('edits without replacing an unchanged secret and confirms deletion', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(origin);
        await page.getByText('Demo token', { exact: true }).click();
        await page.getByRole('button', { name: 'Edit Credential', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).fill('Updated token');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.getByText('Updated token', { exact: true }).waitFor();
        const savedCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'credential-save')
        ));
        expect(savedCalls.at(-1)?.[1]).toMatchObject({ id: 'credential-1', secret: undefined });

        await page.getByRole('button', { name: 'Show Secret', exact: true }).click();
        await page.getByText('fixture-secret-value', { exact: true }).waitFor();
        await page.evaluate(() => { (window as any).__CONFIRM__ = false; });
        await page.getByRole('button', { name: 'Delete Credential', exact: true }).click();
        await expect(page.getByText('Updated token', { exact: true }).count()).resolves.toBe(1);
        await page.evaluate(() => { (window as any).__CONFIRM__ = true; });
        await page.getByRole('button', { name: 'Delete Credential', exact: true }).click();
        await expect.poll(() => page.getByText('Updated token', { exact: true }).count()).toBe(0);
        await page.close();
    });

    it('starts, opens, cancels, and retries a machine provider login', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=empty`);
        await page.getByText('Add Account', { exact: true }).dispatchEvent('click');
        await page.getByRole('button', { name: 'Grok', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('secondary');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByText('ABCD-EFGH', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Open Grok', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();

        const state = await page.evaluate(() => (window as any).__FIXTURE_STATE__);
        expect(state.opened).toEqual(['https://accounts.x.ai/device']);
        expect(state.calls.filter((call: unknown[]) => call[0] === 'login-start')).toHaveLength(2);
        expect(state.calls.filter((call: unknown[]) => call[0] === 'login-cancel')).toHaveLength(2);
        await page.close();
    });

    it('submits a Claude verification code through the selected machine', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=empty`);
        await page.getByText('Add Account', { exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('claude-work');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByLabel('Verification Code', { exact: true }).fill('one-time-code');
        await page.getByRole('button', { name: 'Submit Code', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.some((call: unknown[]) => call[0] === 'login-submit')
        ))).toBe(true);
        const calls = await page.evaluate(() => (window as any).__FIXTURE_STATE__.calls);
        expect(calls).toContainEqual(['login-submit', 'machine-1', 'flow-1', 'one-time-code']);
        await page.close();
    });

    it('shows a terminal login failure and retries without keeping a failed account', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=login-failure`);
        await page.getByText('Add Account', { exact: true }).click();
        await page.getByRole('button', { name: 'Grok', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('recovered');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByText('Provider denied the login.', { exact: true }).waitFor({ timeout: 4_000 });
        expect(await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.accounts.some((account: any) => account.name === 'recovered')
        ))).toBe(false);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await page.getByText('Account saved', { exact: true }).waitFor({ timeout: 6_000 });
        const state = await page.evaluate(() => (window as any).__FIXTURE_STATE__);
        expect(state.calls.filter((call: unknown[]) => call[0] === 'login-start')).toHaveLength(2);
        expect(state.accounts.filter((account: any) => account.name === 'recovered')).toHaveLength(1);
        await page.close();
    }, 10_000);

    it('cancels an active provider login when the settings view unmounts', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=empty`);
        await page.getByText('Add Account', { exact: true }).dispatchEvent('click');
        await page.getByLabel('Nickname', { exact: true }).fill('leaving');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByText('Waiting for provider login', { exact: true }).waitFor();
        await page.evaluate(() => (window as any).__ROOT__.unmount());
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-cancel').length
        ))).toBe(1);
        await page.close();
    });

    it('retries a transient status failure without starting a second login', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=poll-retry`);
        await page.getByText('Add Account', { exact: true }).dispatchEvent('click');
        await page.getByRole('button', { name: 'Grok', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('retry-status');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByText('Temporary status failure', { exact: true }).waitFor({ timeout: 4_000 });
        await page.getByText('Account saved', { exact: true }).waitFor({ timeout: 4_000 });
        const calls = await page.evaluate(() => (window as any).__FIXTURE_STATE__.calls);
        expect(calls.filter((call: unknown[]) => call[0] === 'login-start')).toHaveLength(1);
        expect(calls.filter((call: unknown[]) => call[0] === 'login-cancel')).toHaveLength(0);
        await page.close();
    }, 10_000);

    it('ignores an account mutation that resolves after switching machines', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${origin}/?scenario=deferred-mutation`);
        await page.getByText('personal', { exact: true }).click();
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.some((call: unknown[]) => call[0] === 'account-use')
        ))).toBe(true);

        await page.getByText('Studio', { exact: true }).first().click();
        await page.getByText('Laptop', { exact: true }).click();
        await page.getByText('laptop-only', { exact: true }).waitFor();
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseMutation());
        await expect.poll(() => page.getByText('laptop-only', { exact: true }).count()).toBe(1);
        await expect(page.getByText('personal', { exact: true }).count()).resolves.toBe(0);
        await page.close();
    });

    it('keeps an account mutation live across same-machine heartbeat updates', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${origin}/?scenario=heartbeat-during-mutation`);
        await page.getByText('personal', { exact: true }).click();
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-use').length
        ))).toBe(1);
        const initialListCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-list').length
        ));

        await page.evaluate(() => {
            const state = (window as any).__FIXTURE_STATE__;
            const machines = state.machines.map((machine: any) => ({
                ...machine,
                activeAt: machine.activeAt + 20_000,
                metadata: { ...machine.metadata },
            }));
            (window as any).__SET_MACHINES__(machines);
        });
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-list').length
        ))).toBe(initialListCalls);

        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseMutation());
        await expect.poll(() => page.getByRole('button', { name: 'Set as Default', exact: true }).count()).toBe(0);
        await expect(page.getByRole('button', { name: 'Rename', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('keeps loaded accounts when the selected machine is selected again', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(origin);
        await page.getByRole('button', { name: /work/ }).waitFor();
        const initialListCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-list').length
        ));

        await page.getByText('Studio', { exact: true }).first().click();
        await page.getByText('Studio', { exact: true }).last().click();
        await page.waitForTimeout(100);

        expect(await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-list').length
        ))).toBe(initialListCalls);
        await expect(page.getByRole('button', { name: /work/ }).count()).resolves.toBe(1);
        await expect(page.getByText('Loading…', { exact: true }).count()).resolves.toBe(0);
        await page.close();
    });

    it('unlocks account controls when a machine disconnects during a mutation', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=heartbeat-during-mutation`);
        await page.getByRole('button', { name: /personal/ }).click();
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-use').length
        ))).toBe(1);

        await page.evaluate(() => {
            const state = (window as any).__FIXTURE_STATE__;
            (window as any).__SET_MACHINES__(state.machines.map((machine: any) => ({
                ...machine,
                active: false,
                activeAt: machine.activeAt + 20_000,
            })));
        });
        await page.getByText('This machine is offline', { exact: true }).waitFor();

        await page.evaluate(() => {
            const state = (window as any).__FIXTURE_STATE__;
            (window as any).__SET_MACHINES__(state.machines.map((machine: any) => ({
                ...machine,
                active: true,
                activeAt: machine.activeAt + 20_000,
            })));
        });
        await page.getByRole('button', { name: /personal/ }).waitFor();
        await expect(page.getByRole('button', { name: 'Set as Default', exact: true }).isDisabled()).resolves.toBe(false);

        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseMutation());
        await expect.poll(() => page.getByRole('button', { name: 'Set as Default', exact: true }).count()).toBe(1);
        await page.close();
    });

    it('reloads a stale account version before retrying the mutation', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=stale-account-mutation`);
        await page.getByRole('button', { name: /personal/ }).click();
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();

        const message = 'This provider account changed. Refresh accounts and retry';
        await page.getByText(message, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Reload', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-list').length
        ))).toBeGreaterThanOrEqual(2);
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();
        await expect.poll(() => page.getByRole('button', { name: 'Set as Default', exact: true }).count()).toBe(0);

        const useCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-use')
        ));
        expect(useCalls).toHaveLength(2);
        expect(useCalls[1][2].expectedCredentialVersion).toBe(2);
        await page.close();
    });

    it.each([
        ['mutation', 'long-account-mutation-error', 'Set as Default', 'Account update unavailable', true],
        ['login', 'long-account-login-error', 'Log In Again', 'Provider login unavailable', true],
    ] as const)('keeps a lower-row account %s error and recovery visible on mobile', async (
        _operation,
        scenario,
        action,
        message,
        hasReload,
    ) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=${scenario}`);
        await page.getByRole('button', { name: /Provider account 100/ }).click();
        await page.getByRole('button', { name: action, exact: true }).click();

        const error = page.getByText(message, { exact: true });
        await error.waitFor();
        expect(await error.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.top < window.innerHeight && box.bottom > 0;
        })).toBe(true);
        if (hasReload) {
            await expect(page.getByRole('button', { name: 'Reload', exact: true }).isDisabled()).resolves.toBe(false);
        } else {
            await expect(page.getByRole('button', { name: action, exact: true }).isDisabled()).resolves.toBe(false);
        }
        await page.close();
    });

    it('reloads a stale account version before retrying an existing-account login', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=stale-account-relogin`);
        await page.getByRole('button', { name: /personal/ }).click();
        await page.getByRole('button', { name: 'Log In Again', exact: true }).click();

        const message = 'This provider account changed. Refresh accounts and retry';
        await page.getByText(message, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Reload', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-list').length
        ))).toBeGreaterThanOrEqual(2);

        await page.getByRole('button', { name: 'Log In Again', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-start').length
        ))).toBe(2);
        const loginCalls = await page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-start')
        ));
        expect(loginCalls[1][2].expectedCredentialVersion).toBe(2);
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.close();
    });

    it('keeps a delayed existing-account login error visible after collapsing and reopening its row', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=deferred-account-login-error`);
        await page.getByRole('button', { name: /personal/ }).click();
        await page.getByRole('button', { name: 'Log In Again', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-start').length
        ))).toBe(1);

        await page.getByRole('button', { name: /personal/ }).click();
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseLogin());
        await page.getByRole('button', { name: /personal/ }).click();
        await page.getByText('Provider login unavailable', { exact: true }).waitFor();
        await expect(page.getByRole('button', { name: 'Reload', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('serializes account mutations while a provider login is active', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(origin);
        await page.getByRole('button', { name: 'Add Account', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('active-login');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByLabel('Verification Code', { exact: true }).waitFor();

        await page.getByRole('button', { name: /personal/ }).click();
        for (const action of ['Set as Default', 'Rename', 'Log In Again', 'Remove from Machine']) {
            await expect(page.getByRole('button', { name: action, exact: true }).isDisabled()).resolves.toBe(true);
        }
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.getByText('Login canceled', { exact: true }).waitFor();
        await expect(page.getByRole('button', { name: 'Set as Default', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('does not let a retry replace a pending account mutation busy state', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=deferred-mutation`);
        await page.getByRole('button', { name: 'Add Account', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('retry-after-cancel');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByLabel('Verification Code', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.getByText('Login canceled', { exact: true }).waitFor();

        await page.getByRole('button', { name: /personal/ }).click();
        await page.getByRole('button', { name: 'Set as Default', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'account-use').length
        ))).toBe(1);
        await expect(page.getByRole('button', { name: 'Retry', exact: true }).isDisabled()).resolves.toBe(true);

        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseMutation());
        await expect(page.getByRole('button', { name: 'Retry', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it.each([
        ['rename', 'work', 'Rename', 'Save', 'account-rename'],
        ['remove', 'personal', 'Remove from Machine', 'Remove from Machine', 'account-remove'],
    ] as const)('keeps the new machine row expanded after a stale %s resolves', async (_kind, accountName, action, confirmAction, callName) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${origin}/?scenario=deferred-${_kind}`);
        await page.getByRole('button', { name: new RegExp(accountName) }).click();
        await page.getByRole('button', { name: action, exact: true }).click();
        if (_kind === 'rename') {
            await page.getByLabel('Nickname', { exact: true }).fill('renamed-late');
            await page.getByRole('button', { name: confirmAction, exact: true }).click();
        }
        await expect.poll(async () => page.evaluate((expectedCall) => (
            (window as any).__FIXTURE_STATE__.calls.some((call: unknown[]) => call[0] === expectedCall)
        ), callName)).toBe(true);

        await page.getByRole('button', { name: /Studio/ }).click();
        await page.getByRole('button', { name: /Laptop/ }).click();
        await page.getByRole('button', { name: /laptop-only/ }).click();
        await page.getByRole('button', { name: 'Rename', exact: true }).waitFor();
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseMutation());
        await expect.poll(() => page.getByRole('button', { name: 'Rename', exact: true }).count()).toBe(1);
        await page.close();
    });

    it('cancels a login start that resolves after switching machines', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${origin}/?scenario=deferred-login`);
        await page.getByText('Add Account', { exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('late-login');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.some((call: unknown[]) => call[0] === 'login-start')
        ))).toBe(true);

        await page.getByText('Studio', { exact: true }).first().click();
        await page.getByText('Laptop', { exact: true }).click();
        await page.getByText('laptop-only', { exact: true }).waitFor();
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseLogin());
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-cancel').length
        ))).toBe(1);
        await expect(page.getByText('Waiting for provider login', { exact: true }).count()).resolves.toBe(0);
        await page.close();
    });

    it.each([
        ['mutation', 'deferred-mutation', 'personal', 'Set as Default', 'account-use', 'releaseMutation'],
        ['login', 'deferred-login', 'Add Account', 'Log In', 'login-start', 'releaseLogin'],
    ] as const)('cleans up a deferred account %s when the selected machine is removed', async (
        kind,
        scenario,
        opener,
        action,
        callName,
        releaseName,
    ) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${origin}/?scenario=${scenario}`);
        await page.getByRole('button', { name: new RegExp(opener) }).click();
        if (kind === 'login') {
            await page.getByLabel('Nickname', { exact: true }).fill('removed-machine-login');
        }
        await page.getByRole('button', { name: action, exact: true }).click();
        await expect.poll(async () => page.evaluate((expectedCall) => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === expectedCall).length
        ), callName)).toBe(1);

        await page.evaluate(() => {
            const state = (window as any).__FIXTURE_STATE__;
            (window as any).__SET_MACHINES__(
                state.machines.filter((machine: any) => machine.id !== 'machine-1'),
            );
        });
        await page.getByText('laptop-only', { exact: true }).waitFor();
        await page.getByRole('button', { name: /laptop-only/ }).click();
        await expect(page.getByRole('button', { name: 'Rename', exact: true }).isDisabled()).resolves.toBe(false);

        await page.evaluate((release) => (window as any).__FIXTURE_STATE__[release](), releaseName);
        if (kind === 'login') {
            await expect.poll(async () => page.evaluate(() => (
                (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-cancel').length
            ))).toBe(1);
        }
        await expect.poll(() => page.getByText('laptop-only', { exact: true }).count()).toBe(1);
        await page.close();
    });

    it.each([
        ['Add Account'],
        ['Cancel'],
    ] as const)('cancels a delayed login start and unlocks controls through %s', async (closeAction) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=deferred-login`);
        await page.getByRole('button', { name: 'Add Account', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('slow-login');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-start').length
        ))).toBe(1);

        await page.getByRole('button', { name: closeAction, exact: true }).click();
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseLogin());
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-cancel').length
        ))).toBe(1);

        await page.getByRole('button', { name: 'Add Account', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('retry-login');
        await expect(page.getByRole('button', { name: 'Log In', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('unlocks account controls after canceling a deferred verification-code submit', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=deferred-submit`);
        await page.getByRole('button', { name: 'Add Account', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('code-login');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByLabel('Verification Code', { exact: true }).fill('verification-code');
        await page.getByRole('button', { name: 'Submit Code', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => (
            (window as any).__FIXTURE_STATE__.calls.filter((call: unknown[]) => call[0] === 'login-submit').length
        ))).toBe(1);

        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.getByText('Login canceled', { exact: true }).waitFor();
        await page.evaluate(() => (window as any).__FIXTURE_STATE__.releaseSubmit());
        await page.getByRole('button', { name: /personal/ }).click();
        await expect(page.getByRole('button', { name: 'Set as Default', exact: true }).isDisabled()).resolves.toBe(false);
        await page.close();
    });

    it('clears an entered verification code before retrying a canceled login', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(origin);
        await page.getByRole('button', { name: 'Add Account', exact: true }).click();
        await page.getByLabel('Nickname', { exact: true }).fill('code-retry');
        await page.getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByLabel('Verification Code', { exact: true }).fill('expired-code');
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.getByText('Login canceled', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();

        await page.getByLabel('Verification Code', { exact: true }).waitFor();
        await expect(page.getByLabel('Verification Code', { exact: true }).inputValue()).resolves.toBe('');
        await page.getByRole('button', { name: 'Cancel Login', exact: true }).click();
        await page.close();
    });

    it.each([
        ['offline', 'This machine is offline'],
        ['unsupported', 'Update and restart HappyHerd on this machine to manage accounts'],
        ['none', 'No machines available'],
        ['error', 'Machine request failed'],
    ])('shows an honest %s state', async (scenario, expected) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${origin}/?scenario=${scenario}`);
        await page.getByText(expected, { exact: true }).first().waitFor();
        await page.close();
    });
});
