import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PRODUCT } from '../../../constants/product';
import { darkTheme, lightTheme } from '@/theme';

/**
 * UI overhaul session screen (Web Desktop 1440×900 and Web Mobile 390×844):
 * the production SessionView over synthetic storage and transport. Every test
 * performs the gesture a person would — clicking the header menu, a tool row,
 * a composer chip, or pressing a number key — and checks the visible outcome.
 *
 * Set HAPPYHERD_SESSION_EVIDENCE_DIR to also save review screenshots.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sources = resolve(appRoot, 'sources');
const evidenceDir = process.env.HAPPYHERD_SESSION_EVIDENCE_DIR?.trim() || null;

// The side-chat SessionView fixture owns the service boundaries (storage,
// sync, ops, modal, navigation). Reuse it, then return the session-screen
// components to production and supply this suite's transcript.
function readSideChatFixtureModules(): Record<string, string> {
    const file = resolve(appRoot, 'sources/components/sideChatHeader.browser.test.ts');
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (declaration.name.getText(ast) !== 'virtualModules' || !declaration.initializer) continue;
            return runInNewContext(`(${declaration.initializer.getText(ast)})`, {
                appRoot,
                here: resolve(appRoot, 'sources/components'),
                resolve,
                PRODUCT,
                newSessionProjectPath: '/work/project/extensions/browser-tools',
                newSessionRecentPath: (index: number) => `/workspace/products/example-project-${String(index).padStart(2, '0')}`,
            });
        }
    }
    throw new Error('sideChatHeader.browser.test.ts no longer declares virtualModules');
}

function replaceOnce(source: string, search: string, replacement: string, label: string): string {
    if (!source.includes(search)) throw new Error(`Fixture adapter drifted: ${label}`);
    return source.replace(search, replacement);
}

const minute = 60_000;
const editOld = 'export async function getToken() {\n    const raw = storage.get(KEY);\n    return raw ?? refresh();\n}';
const editNew = 'export async function getToken() {\n    const raw = storage.get(KEY);\n    if (!raw?.trim()) {\n        return refreshOrThrow();\n    }\n    return raw;\n}';
const tool = (id: string, at: number, name: string, input: unknown, extra: Record<string, unknown> = {}) => ({
    kind: 'tool-call', id, localId: null, createdAt: at, children: [],
    tool: {
        name, input, description: null, state: 'completed', result: 'ok',
        createdAt: at, startedAt: at, completedAt: at + 400, ...extra,
    },
});
const questions = [{
    header: 'Browsers',
    question: 'Which mobile browsers should the regression tests validate for the session fallback?',
    multiSelect: false,
    options: [
        { label: 'Safari and Chrome only', description: 'Covers iOS Safari and Android Chrome engines.' },
        { label: 'All supported engines', description: 'Includes WebKit, Blink, and Firefox mobile builds.' },
        { label: 'Default browser only', description: 'Runs tests using the host OS default emulator.' },
    ],
}];

// Oldest first here; the storage adapter hands the list over newest-first
// with times relative to page load.
type Scene = 'permission' | 'permission-older' | 'question' | 'short-reply' | 'skill-permission';

function transcript(scene: Scene): unknown[] {
    const turnOne = [
        { kind: 'user-text', id: 'u1', localId: null, createdAt: -9 * minute, text: 'Fix the flaky auth timeout test in `auth.test.ts`.' },
        { kind: 'agent-text', id: 'a1', localId: null, createdAt: -9 * minute + 2000, text: 'I will trace the timeout path first.' },
        tool('t1', -9 * minute + 4000, 'Read', { file_path: '/work/web-app/src/auth/getToken.ts' }),
        tool('t2', -9 * minute + 8000, 'Edit', { file_path: '/work/web-app/src/auth/getToken.ts', old_string: editOld, new_string: editNew }),
        tool('t3', -9 * minute + 12000, 'Bash', { command: 'pnpm vitest run src/auth' }, { result: '✓ src/auth/getToken.test.ts (14)\n\nTest Files  1 passed (1)\n     Tests  14 passed (14)' }),
        tool('t4', -9 * minute + 20000, 'TodoWrite', { todos: [
            { id: '1', content: 'Reproduce the flaky timeout', status: 'completed' },
            { id: '2', content: 'Treat empty storage values as missing', status: 'completed' },
            { id: '3', content: 'Verify on mobile Safari', status: 'in_progress' },
        ] }),
        {
            kind: 'agent-text', id: 'a2', localId: null, createdAt: -8 * minute,
            text: '<happyherd-safeguard-reminder status="ready">The fix and its verification scope are clear.</happyherd-safeguard-reminder>\n\n'
                + 'Updated **retry handling** in `getToken()`:\n\n- Empty storage values are treated as missing\n'
                + "- `getToken()` throws `AuthError('missing token')` when refresh fails\n\n14 passed, 0 failed.\n\n"
                + '<options>\n<option>Run the full suite</option>\n<option>Open a pull request</option>\n</options>',
        },
        { kind: 'agent-event', id: 'e1', createdAt: -8 * minute + 1000, event: { type: 'switch', mode: 'acceptEdits' } },
    ];
    const turnTwo = [
        { kind: 'user-text', id: 'u2', localId: null, createdAt: -2 * minute, text: 'Also verify on mobile Safari before committing.' },
        { kind: 'agent-text', id: 'a3', localId: null, createdAt: -2 * minute + 2000, text: 'Checking the Safari session fallback now.' },
        tool('t5', -2 * minute + 4000, 'Read', { file_path: '/work/web-app/src/auth/session.ts' }),
        tool('t6', -2 * minute + 6000, 'Edit', { file_path: '/work/web-app/src/auth/session.ts', old_string: 'return cached;', new_string: 'if (isPrivateMode()) return null;\nreturn cached;' }),
        ...(scene === 'skill-permission' ? [
            // Claude Code asks before loading a skill; the Skill tool is otherwise hidden.
            tool('t10', -1000, 'Skill', { skill: 'workspace-manage-tasks' }, {
                state: 'running', result: undefined, completedAt: null,
                permission: { id: 'perm-skill', status: 'pending' },
            }),
        ] : scene !== 'question' ? [
            tool('t7', -3000, 'Bash', { command: 'pnpm test:e2e --project=webkit' }, { state: 'running', result: undefined, completedAt: null }),
            tool('t8', -1000, 'Bash', { command: 'git push origin fix/auth-timeout', description: 'Push the fix branch' }, {
                state: 'running', result: undefined, completedAt: null,
                permission: { id: 'perm-push', status: 'pending', reason: 'Publishing the branch needs approval.' },
            }),
            // The request stays pending while later rows arrive, so it scrolls up with the chat.
            ...(scene === 'permission-older' ? Array.from({ length: 6 }, (_, index) => ({
                kind: 'agent-text', id: `later-${index}`, localId: null, createdAt: -900 + index * 50,
                text: `Webkit run ${index + 1}: the private-tab fallback returns null before the cache read, the token refresh path `
                    + 'stays untouched, and the session store keeps its existing keys, so no migration is needed for this change.',
            })) : []),
        ] : [
            tool('t9', -1000, 'AskUserQuestion', { questions }, {
                state: 'running', result: undefined, completedAt: null,
                permission: { id: 'perm-question', status: 'pending' },
            }),
        ]),
        // A one-word reply, which must fit its bubble on one line.
        ...(scene === 'short-reply' ? [
            { kind: 'user-text', id: 'u3', localId: null, createdAt: -700, text: 'continue' },
        ] : []),
        {
            kind: 'user-text', id: 'q1-message', localId: 'q1', createdAt: -500,
            text: 'Verify the fix using the simulator before committing the changes.',
            meta: { deliveryMode: 'queue', queueMessageId: 'q1' },
        },
    ];
    return [...turnOne, ...turnTwo].reverse();
}

function sessionScreenModules(): Record<string, string> {
    const modules = readSideChatFixtureModules();
    // Production session-screen renderers, catalogs and icons.
    for (const key of [
        '@/text', '@expo/vector-icons', 'expo-linear-gradient', '@/components/AgentContentView', '@/components/AgentGoalBar',
        '@/components/QueuedMessagesPanel', '@/components/EmptyMessages', '@/components/SessionStatusBar',
        '@/components/ProviderIcon', '@/components/modelModeOptions', '@/components/agentGoalStatus',
        '@/sync/queueProjection', '@/utils/sessionStatusBar', '@/utils/rigGitLineChanges', '@/sync/rig',
        '@/components/diff/PierreDiffView', '@/keyboard/shortcuts',
    ]) delete modules[key];

    modules['react-native'] = `
        import * as RN from 'react-native-web'; import React from 'react';
        export * from 'react-native-web';
        export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) };
        export const useAnimatedValue = (value) => React.useRef(new RN.Animated.Value(value)).current;
    `;
    // Unistyles web adapter: \`_web\` CSS merges into the style, \`_classNames\`
    // and pseudo states (\`_hover\`, \`_focus-within\`) become real classes, as
    // Unistyles' own web runtime does.
    modules['react-native-unistyles'] = `
        import { lightTheme, darkTheme } from '@/theme';
        const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
        const sheet = document.createElement('style');
        sheet.dataset.fixture = 'unistyles-web';
        document.head.appendChild(sheet);
        const unitless = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight']);
        const kebab = (key) => key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
        const cssValue = (key, value) => typeof value === 'number' && !unitless.has(key) ? value + 'px' : String(value);
        const ruleCache = new Map();
        let counter = 0;
        const pseudoClass = (pseudo, body) => {
            const id = pseudo + JSON.stringify(body);
            if (ruleCache.has(id)) return ruleCache.get(id);
            const className = 'uw-' + (++counter);
            const declarations = Object.entries(body).map(([key, value]) => kebab(key) + ':' + cssValue(key, value) + ' !important').join(';');
            sheet.appendChild(document.createTextNode('.' + className + ':' + pseudo.slice(1) + '{' + declarations + '}'));
            ruleCache.set(id, className);
            return className;
        };
        const transform = (style) => {
            if (!style || typeof style !== 'object' || Array.isArray(style) || !style._web) return style;
            const { _web, ...plain } = style;
            const { _classNames, ...web } = _web;
            const classes = _classNames ? [].concat(_classNames).filter(Boolean) : [];
            for (const [key, value] of Object.entries(web)) {
                if (key.startsWith('_') && value && typeof value === 'object') classes.push(pseudoClass(key, value));
                else plain[key] = value;
            }
            return classes.length ? [plain, { $$css: true, ['uw' + (++counter)]: classes.join(' ') }] : plain;
        };
        export const StyleSheet = {
            hairlineWidth: 1,
            absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
            create: (factory) => {
                const styles = typeof factory === 'function' ? factory(theme, { screen: { width: innerWidth, height: innerHeight } }) : factory;
                const out = {};
                for (const [key, value] of Object.entries(styles)) {
                    out[key] = typeof value === 'function' ? (...args) => transform(value(...args)) : transform(value);
                }
                return out;
            },
        };
        export const useUnistyles = () => ({ theme, rt: { themeName: theme.dark ? 'dark' : 'light' } });
        export const withUnistyles = (Component) => Component;
        export const UnistylesRuntime = { setTheme() {}, setAdaptiveThemes() {}, setRootViewBackgroundColor() {} };
    `;
    modules['expo-image'] = `import React from 'react'; import { Image as RealImage } from '${resolve(appRoot, '../../node_modules/expo-image/src/Image.tsx')}'; import { Image as NativeImage } from 'react-native-web';
        export const Image = React.forwardRef(({ contentFit, source, tintColor, ...props }, ref) => window.__HAPPYHERD_FIXTURE_OPTIONS__?.attachmentJourney ? React.createElement(RealImage, { ...props, contentFit, source, tintColor, ref }) : React.createElement(NativeImage, {
            ...props, ref, source: typeof source === 'string' ? { uri: source } : source,
            resizeMode: contentFit === 'cover' ? 'cover' : 'contain',
        }));`;
    modules['expo-font'] = `export const isLoaded = () => true; export const isLoading = () => false; export const loadAsync = async () => {}; export const useFonts = () => [true, null]; export const getLoadedFonts = () => [];`;
    modules['expo-localization'] = `export const getLocales = () => [{ languageTag: 'en-US', languageCode: 'en' }];`;
    // CustomModal's unrelated palette identity branch is never rendered by this fixture.
    modules['@/components/CommandPalette'] = `export const CommandPalette = () => { throw new Error('Unexpected command palette in attachment fixture'); };`;
    // Attachment previews exercise the actual modal manager/provider/portal.
    // Preserve the existing service-boundary modal for unrelated session scenes.
    modules['@/modal'] = modules['@/modal'].replace('export const Modal = {', 'const FixtureModal = {')
        + `import { Modal as ActualModal } from '${resolve(sources, 'modal/ModalManager.ts')}';
           export const Modal = window.__HAPPYHERD_FIXTURE_OPTIONS__?.attachmentJourney ? ActualModal : FixtureModal;`;
    modules['@/sync/persistence'] = `export const loadSettings = () => ({ settings: { preferredLanguage: 'en' } }); export const storeTempText = () => 'synthetic-temp';`;
    modules['@/realtime/RealtimeSession'] = `export const stopRealtimeSession = async () => {}; export const getCurrentVoiceSessionDurationSeconds = () => 0;`;
    modules['@/hooks/useAttachmentImage'] = `import { useAttachmentImage as actual } from '${resolve(sources, 'hooks/useAttachmentImage.ts')}'; export const useAttachmentImage = (...args) => window.__HAPPYHERD_FIXTURE_OPTIONS__?.attachmentJourney ? actual(...args) : { uri: null, error: null };`;
    // Production image/hook/decoder; only the encryption and transport boundaries are synthetic.
    modules['@/sync/sync'] += `
        sync.getCredentials = () => ({ token: 'fixture-only-not-a-credential' });
        sync.encryption = { getSessionBlobKey: () => new Uint8Array(32) };
    `;
    modules['@/sync/apiAttachments'] = `
        export async function downloadEncryptedAttachment(_credentials, _sessionId, ref) {
            window.__ATTACHMENT_DOWNLOADS__ = [...(window.__ATTACHMENT_DOWNLOADS__ ?? []), ref];
            return new Promise((resolve, reject) => {
                window.__RESOLVE_ATTACHMENT_DOWNLOAD__ = () => {
                    if (window.__HAPPYHERD_FIXTURE_OPTIONS__?.attachmentOutcome === 'download-error') reject(new Error('fixture forced download failure'));
                    else resolve(new Uint8Array([1, 2, 3]));
                };
            });
        }
    `;
    modules['@/encryption/blob'] = `
        export function decryptBlob() {
            window.__ATTACHMENT_DECRYPTS__ = (window.__ATTACHMENT_DECRYPTS__ ?? 0) + 1;
            if (window.__HAPPYHERD_FIXTURE_OPTIONS__?.attachmentOutcome === 'decrypt-error') return null;
            // Valid PNG generated by Canvas in the fixture, never downloaded from a service.
            return Uint8Array.from(atob(window.__ATTACHMENT_PNG__), (character) => character.charCodeAt(0));
        }
    `;
    modules['@react-native-masked-view/masked-view'] = `import React from 'react'; import { View } from 'react-native'; export default ({ maskElement, style }) => React.createElement(View, { style }, maskElement);`;
    modules['react-native-reanimated'] = modules['react-native-reanimated']
        .replace('export default { ScrollView, Text, View };', 'export default { ScrollView, Text, View, createAnimatedComponent: (Component) => Component };')
        + `export const cancelAnimation = () => {}; export const withSpring = (value) => value; export const useAnimatedRef = () => React.useRef(null);
           export const measure = () => ({ width: 24, height: 24 });
           export const FadeIn = { duration: () => ({}) }; export const FadeOut = { duration: () => ({}) };`;

    // Session status comes from production; identity helpers stay synthetic.
    modules['@/utils/sessionUtils'] = modules['@/utils/sessionUtils'].replace(
        /export const useSessionStatus = [^\n]+;/,
        `export { useSessionStatus } from '${resolve(sources, 'utils/sessionUtils.ts')}';`,
    );

    // Permission answers and archive actions are observable.
    let ops = modules['@/sync/ops'];
    ops = replaceOnce(ops, 'export const sessionAllow = async () => {};',
        `export const sessionAllow = async (...args) => { window.__PERMISSION_CALLS__ = [...(window.__PERMISSION_CALLS__ ?? []), ['allow', ...args]]; };`, 'sessionAllow');
    ops = replaceOnce(ops, 'export const sessionDeny = async () => {};',
        `export const sessionDeny = async (...args) => { window.__PERMISSION_CALLS__ = [...(window.__PERMISSION_CALLS__ ?? []), ['deny', ...args]]; };`, 'sessionDeny');
    ops = replaceOnce(ops, `export const sessionKill = async (sessionId) => {
            const calls = window.__SESSION_KILL_CALLS__ = [...(window.__SESSION_KILL_CALLS__ ?? []), sessionId];
            const results = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.botArchiveResults ?? [];
            const accepted = results[calls.length - 1] ?? true;
            return accepted
                ? { success: true, message: 'accepted by owning machine' }
                : { success: false, message: '' };
        };`, `export const sessionKill = async (sessionId) => {
            window.__SESSION_KILL_CALLS__ = [...(window.__SESSION_KILL_CALLS__ ?? []), sessionId];
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.archiveJourney) {
                return await new Promise((resolve) => {
                    window.__ARCHIVE_KILL_PENDING__ = true;
                    window.__RESOLVE_ARCHIVE_KILL__ = (success) => {
                        window.__ARCHIVE_KILL_PENDING__ = false;
                        resolve({ success, message: success ? 'machine accepted' : 'machine unavailable' });
                    };
                });
            }
            return { success: true, message: 'ok' };
        };`, 'sessionKill');
    ops = replaceOnce(ops, `window.__SESSION_ARCHIVE_CALLS__ = [...(window.__SESSION_ARCHIVE_CALLS__ ?? []), sessionId];
            return { success: true };`, `window.__SESSION_ARCHIVE_CALLS__ = [...(window.__SESSION_ARCHIVE_CALLS__ ?? []), sessionId];
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.archiveJourney) {
                return { success: window.__ARCHIVE_FALLBACK_SUCCESS__ === true, message: 'fixture fallback unavailable' };
            }
            return { success: true };`, 'deferred archive fallback');
    modules['@/sync/ops'] = ops;

    // Storage: a Claude session with a finished turn, a live turn, a goal, a
    // queued follow-up and a continuation, plus context and git numbers.
    let storage = modules['@/sync/storage'];
    storage = replaceOnce(storage, 'const settings = {', `const settings = {
            groupToolCalls: true,
            compactToolCalls: true,
            alwaysShowContextSize: true,
            userMessageBubbleColor: 'gray',
            showLineNumbersInToolViews: false,`, 'settings');
    storage = replaceOnce(storage, 'const sessionList = Object.values(sessions);', `
        const screen = fixtureOptions.sessionScreen;
        if (screen) {
            const at = Date.now();
            const permission = screen === 'permission' || screen === 'permission-older';
            sessions.parent = {
                ...sessions.parent,
                thinking: false,
                modelMode: 'claude-opus-5-5',
                effortLevel: 'xhigh',
                permissionMode: 'default',
                metadata: {
                    ...sessions.parent.metadata,
                    flavor: 'claude',
                    claudeSessionId: 'claude-parent',
                    codexThreadId: undefined,
                    path: '/work/web-app',
                    gitBranch: 'fix/auth-timeout',
                    summary: { text: 'Fix flaky auth timeout test' },
                },
                agentState: {
                    requests: permission
                        ? { 'perm-push': { tool: 'Bash', arguments: { command: 'git push origin fix/auth-timeout' }, createdAt: at - 1000 } }
                        : { 'perm-question': { tool: 'AskUserQuestion', arguments: {}, createdAt: at - 1000 } },
                    messageQueue: { pendingMessageIds: ['q1'], currentMessageIds: [] },
                    agentGoalStatus: {
                        status: 'active', source: 'claude', sourceSessionId: 'claude-parent', observedAt: at,
                        text: 'Fix getToken fallback for mobile Safari private tabs',
                        capabilities: { edit: true, stop: true, clear: true },
                    },
                },
            };
        }
        const sessionList = Object.values(sessions);`, 'sessions');
    storage = replaceOnce(storage, 'const messages = Array.from', 'const oldFixtureMessages = Array.from', 'messages');
    storage = replaceOnce(storage, 'const localhostMessages =', `
        const SESSION_SCREEN_TRANSCRIPTS = ${JSON.stringify({
            permission: transcript('permission'),
            'permission-older': transcript('permission-older'),
            question: transcript('question'),
            'short-reply': transcript('short-reply'),
            'skill-permission': transcript('skill-permission'),
        })};
        const shiftTime = (value, at) => typeof value === 'number' ? at + value : value;
        const messages = fixtureOptions.sessionScreen
            ? (() => {
                const at = Date.now();
                return SESSION_SCREEN_TRANSCRIPTS[fixtureOptions.sessionScreen].map((message) => ({
                    ...message,
                    createdAt: shiftTime(message.createdAt, at),
                    ...(message.tool ? { tool: {
                        ...message.tool,
                        createdAt: shiftTime(message.tool.createdAt, at),
                        startedAt: shiftTime(message.tool.startedAt, at),
                        completedAt: shiftTime(message.tool.completedAt, at),
                    } } : {}),
                }));
            })()
            : oldFixtureMessages;
        const localhostMessages =`, 'transcript');
    storage = replaceOnce(storage, 'export const useSessionGitStatus = () => null;',
        `export const useSessionGitStatus = () => fixtureOptions.sessionScreen ? { branch: 'fix/auth-timeout', unstagedLinesAdded: 18, unstagedLinesRemoved: 3 } : null;`, 'git');
    storage = replaceOnce(storage, 'export const useSessionUsage = () => null;',
        `export const useSessionUsage = () => fixtureOptions.sessionScreen ? { inputTokens: 1200, outputTokens: 800, cacheCreation: 0, cacheRead: 0, contextSize: 36000, contextWindow: 200000 } : null;`, 'usage');
    storage += `\nexport const useRealtimeMode = () => 'idle';
        // Test-only subscription: the production row and archive hook are real;
        // the existing suite's storage and machine/server transport remain synthetic.
        window.__ARCHIVE_STORE__ = { subscribe, getState };
    `;
    modules['@/sync/storage'] = storage;
    return modules;
}

const virtualModules = sessionScreenModules();

function webVariant(path: string): string | null {
    for (const candidate of [`${path}.web.tsx`, `${path}.web.ts`, `${path}.web.js`]) {
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

function sourceFile(path: string): string | undefined {
    return [
        `${path}.web.tsx`, `${path}.web.ts`, `${path}.tsx`, `${path}.ts`, `${path}.js`, path,
        `${path}/index.web.tsx`, `${path}/index.tsx`, `${path}/index.ts`, `${path}/index.js`,
    ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

const fixturePlugin: Plugin = {
    name: 'session-screen-browser-fixture',
    setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.resolveDir.includes('/@shopify/flash-list/') && args.path.startsWith('.')) {
                const webPath = resolve(args.resolveDir, args.path + '.web.js');
                if (existsSync(webPath)) return { path: webPath };
            }
            // Expo's package internals need Metro-style Web resolution as well.
            if (args.path.startsWith('.') && /[\/]node_modules[\/](?:expo-image|expo-modules-core|expo-asset)[\/]/.test(args.resolveDir)) {
                const absolute = resolve(args.resolveDir, args.path);
                const web = webVariant(absolute) ?? webVariant(resolve(absolute, 'index'));
                if (web) return { path: web };
            }
            if (Object.hasOwn(virtualModules, args.path)) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path === './apiSocket' && args.importer.endsWith('/sync/workspaceLive.ts')) {
                return { path: '@/sync/apiSocket', namespace: 'fixture-stub' };
            }
            if (args.path.startsWith('.') && args.resolveDir.startsWith(sources)) {
                const absolute = resolve(args.resolveDir, args.path);
                const key = '@/' + relative(sources, absolute).replace(/\.(?:tsx?|jsx?)$/, '');
                if (Object.hasOwn(virtualModules, key)) return { path: key, namespace: 'fixture-stub' };
                // Metro's web platform resolution, case-exact.
                const web = extname(absolute) ? null : webVariant(absolute);
                if (web) return { path: web };
                const exact = sourceFile(absolute);
                if (exact) return { path: exact };
            }
            if (args.path.startsWith('@/')) {
                const path = sourceFile(resolve(sources, args.path.slice(2)));
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
    },
};

type Viewport = { width: number; height: number };
const DESKTOP: Viewport = { width: 1440, height: 900 };
const MOBILE: Viewport = { width: 390, height: 844 };

describe('Session screen overhaul (Web)', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/sessionScreen.browser.fixture.tsx')],
            outfile: resolve(appRoot, 'fixture-output/session-screen.js'),
            absWorkingDir: appRoot,
            nodePaths: [resolve(appRoot, '../../node_modules')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = Buffer.from(bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.contents);
        const cssFile = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
        const bundleCss = cssFile ? Buffer.from(cssFile.contents).toString('utf8') : '';

        // Fonts: the app faces from the repository and the icon fonts the
        // production icon sets register.
        const fonts = new Map<string, Buffer>();
        let fontFaces = '';
        for (const family of ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold']) {
            fonts.set(`/fonts/${family}.ttf`, readFileSync(resolve(sources, 'assets/fonts', `${family}.ttf`)));
            fontFaces += `@font-face{font-family:'${family}';src:url('/fonts/${family}.ttf') format('truetype');font-display:block;}`;
        }
        const iconRoot = resolve(appRoot, '../../node_modules/@expo/vector-icons/build');
        for (const name of ['Ionicons', 'Octicons', 'MaterialCommunityIcons', 'MaterialIcons', 'FontAwesome', 'Feather', 'AntDesign']) {
            const file = resolve(iconRoot, `${name}.js`);
            if (!existsSync(file)) continue;
            const code = readFileSync(file, 'utf8');
            const fontName = code.match(/createIconSet\(glyphMap, ['"]([^'"]+)/)?.[1];
            const fontFile = code.match(/import font from ['"](.+?\.(?:ttf|otf))['"]/)?.[1];
            if (!fontName || !fontFile) continue;
            const route = `/fonts/${basename(fontFile)}`;
            fonts.set(route, readFileSync(resolve(iconRoot, fontFile)));
            fontFaces += `@font-face{font-family:'${fontName}';src:url('${route}') format('truetype');font-display:block;}`;
        }
        const themeCss = readFileSync(resolve(sources, 'theme.css'), 'utf8');

        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (url.pathname === '/session-screen.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.end(script);
                return;
            }
            if (fonts.has(url.pathname)) {
                response.setHeader('content-type', 'font/ttf');
                response.end(fonts.get(url.pathname));
                return;
            }
            if (url.pathname === '/favicon.ico') {
                response.writeHead(204);
                response.end();
                return;
            }
            const dark = url.searchParams.get('theme') === 'dark';
            const theme = dark ? darkTheme : lightTheme;
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
                + `<style>${fontFaces}${themeCss}${bundleCss}html,body,#root{margin:0;height:100%;background:${theme.colors.surface};color:${theme.colors.text};font-family:SpaceGrotesk-Regular}#root{display:flex;flex-direction:column}</style>`
                + `</head><body><main id="root"></main><script>globalThis.global=globalThis;</script><script src="/session-screen.js"></script></body></html>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('session screen fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
        if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    }, 120_000);

    afterAll(async () => {
        await browser?.close();
        await new Promise<void>((done) => server ? server.close(() => done()) : done());
    });

    for (const viewport of [DESKTOP, MOBILE]) {
        for (const theme of ['light', 'dark'] as const) {
            for (const owner of ['FileView', 'ToolView'] as const) {
                for (const outcome of ['success', 'download-error', 'decrypt-error'] as const) {
                    it(`renders production attachment ${owner} ${outcome} in ${theme} at ${viewport.width} px`, async () => {
                        const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: theme });
                        const errors: string[] = [];
                        const warnings: string[] = [];
                        page.on('pageerror', error => { errors.push(error.message); console.error('[attachment-fixture]', error.message); });
                        page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
                        await page.addInitScript(({ owner, outcome }) => {
                            (window as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { attachmentJourney: owner, attachmentOutcome: outcome };
                        }, { owner, outcome });
                        // No account or external downloads: fixture assets are served only by this local test server.
                        await page.route('**/*', route => new URL(route.request().url()).origin === origin
                            || route.request().url().startsWith('data:') ? route.continue() : route.abort());
                        try {
                            await page.goto(`${origin}/?theme=${theme}`);
                            const tray = page.getByTestId('attachment-journey');
                            await tray.waitFor({ state: 'visible' });
                            const imageButton = tray.getByRole('button', { name: 'Open image at full size: chart.png', exact: true });
                            const filename = imageButton.locator('..').getByText('chart.png', { exact: true });
                            await expect.poll(() => page.evaluate(() => (window as any).__ATTACHMENT_DOWNLOADS__?.length)).toBe(1);
                            expect(await filename.isVisible()).toBe(true);
                            expect(await imageButton.isDisabled()).toBe(true);
                            const frame = await imageButton.evaluate(element => {
                                (window as any).__ATTACHMENT_ORIGINAL_NODE__ = element;
                                const style = getComputedStyle(element);
                                return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
                                    border: style.borderTopWidth, radius: style.borderTopLeftRadius };
                            });
                            expect(frame).toEqual({ width: 282, height: 212, border: '1px', radius: '8px' });
                            // The actual Expo Image placeholder must decode and paint before transport resolves.
                            await expect.poll(() => imageButton.locator('img').evaluateAll(images => images.some(image =>
                                (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
                                && (image as HTMLImageElement).currentSrc.startsWith('data:image/')))).toBe(true);
                            await page.getByRole('button', { name: 'Update attachment metadata' }).click();
                            expect(await imageButton.evaluate(element => element === (window as any).__ATTACHMENT_ORIGINAL_NODE__)).toBe(true);
                            expect(await page.evaluate(() => (window as any).__ATTACHMENT_DOWNLOADS__.length)).toBe(1);
                            await evidence(page, `attachment-pending-${owner}-${outcome}-${theme}-${viewport.width}`);
                            await page.evaluate(() => (window as any).__RESOLVE_ATTACHMENT_DOWNLOAD__());
                            if (outcome === 'success') {
                                await expect.poll(() => imageButton.isEnabled()).toBe(true);
                                await imageButton.click();
                                const preview = page.getByRole('dialog');
                                await preview.waitFor({ state: 'visible' });
                                await expect.poll(() => preview.getByRole('img', { name: 'chart.png' }).isVisible()).toBe(true);
                                await expect.poll(() => preview.locator('img').evaluateAll(images => images.some(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
                                const close = preview.getByRole('button', { name: 'Close image preview' });
                                for (const target of [preview.getByRole('img', { name: 'chart.png' }), close]) {
                                    const box = await target.boundingBox();
                                    expect(box).not.toBeNull();
                                    expect(box!.width).toBeGreaterThan(0);
                                    expect(box!.height).toBeGreaterThan(0);
                                    expect(box!.x).toBeGreaterThanOrEqual(0);
                                    expect(box!.y).toBeGreaterThanOrEqual(0);
                                    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
                                    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
                                }
                                await evidence(page, `attachment-preview-${owner}-${theme}-${viewport.width}`);
                                await preview.getByRole('button', { name: 'Close image preview' }).click();
                                await preview.waitFor({ state: 'detached' });
                                expect(await imageButton.isVisible()).toBe(true);
                                expect(warnings.filter(warning => warning.includes('[attachment-image]'))).toEqual([]);
                            } else {
                                // Production FileView's visible error affordance is its Ionicons alert glyph.
                                await imageButton.getByText(String.fromCodePoint(61716), { exact: true }).waitFor({ state: 'visible' });
                                expect(await imageButton.isDisabled()).toBe(true);
                                expect(await filename.isVisible()).toBe(true);
                                expect(await imageButton.evaluate(element => element === (window as any).__ATTACHMENT_ORIGINAL_NODE__)).toBe(true);
                                expect(warnings.some(warning => warning.includes('[attachment-image]')
                                    && warning.includes(outcome === 'download-error' ? 'download failed' : 'decrypt-returned-null'))).toBe(true);
                                await evidence(page, `attachment-error-${owner}-${outcome}-${theme}-${viewport.width}`);
                            }
                            await page.getByRole('button', { name: 'Update attachment metadata' }).click();
                            expect(await imageButton.evaluate(element => element === (window as any).__ATTACHMENT_ORIGINAL_NODE__)).toBe(true);
                            expect(await page.evaluate(() => (window as any).__ATTACHMENT_DOWNLOADS__.length)).toBe(1);
                            expect(await page.evaluate(() => (window as any).__ATTACHMENT_DECRYPTS__ ?? 0)).toBe(outcome === 'download-error' ? 0 : 1);
                            expect(errors).toEqual([]);
                        } finally {
                            await page.close();
                        }
                    }, 30_000);
                }
            }
        }
    }

    async function openScene(options: { scene: Scene; viewport: Viewport; theme?: 'light' | 'dark'; archiveJourney?: boolean; botLifecycle?: boolean }) {
        const page = await browser.newPage({ viewport: options.viewport, deviceScaleFactor: 1, colorScheme: options.theme ?? 'light' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        await page.addInitScript(({ scene, archiveJourney, botLifecycle }) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { sessionScreen: scene, providerContinuation: true, voiceAvailable: true, archiveJourney, botLifecycle };
        }, options);
        await page.goto(`${origin}/?theme=${options.theme ?? 'light'}`);
        await page.getByTestId('foreground-session').waitFor({ state: 'visible', timeout: 5_000 });
        await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 5_000 });
        await page.evaluate(() => document.fonts.ready);
        // First-paint motion and FlashList measurement settle before gestures.
        await settle(page);
        return { page, errors };
    }

    async function settle(page: Page) {
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        await page.waitForTimeout(450);
    }

    async function evidence(page: Page, name: string) {
        if (!evidenceDir) return;
        await settle(page);
        await page.screenshot({ path: resolve(evidenceDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
    }

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('opens the existing session actions from the header ⋯ button on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'permission', viewport });
        const foreground = page.getByTestId('foreground-session');
        const workspace = foreground.getByRole('button', { name: 'Workspace', exact: true });
        await expect(workspace.isVisible()).resolves.toBe(true);
        if (viewport === MOBILE) {
            // Phones leave the session through the top bar: no Back in the chat header, and
            // the crumb stacks the folder above the title so neither is cut short.
            await expect(foreground.getByRole('button', { name: 'Back', exact: true }).count()).resolves.toBe(0);
            const folder = (await foreground.getByText('web-app', { exact: true }).first().boundingBox())!;
            const title = (await foreground.getByText('Fix flaky auth timeout test', { exact: true }).first().boundingBox())!;
            expect(folder.y + folder.height).toBeLessThanOrEqual(title.y + 1);
            expect(Math.round(folder.x)).toBe(16);
            expect(Math.round(title.x)).toBe(16);
            // The header's controls are 44 px targets.
            for (const control of [workspace, foreground.getByRole('button', { name: 'Session', exact: true })]) {
                const box = (await control.boundingBox())!;
                expect(Math.round(box.height)).toBe(44);
                expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
            }
        }
        await expect(foreground.getByRole('button', { name: 'Open side chats (2)' }).isVisible()).resolves.toBe(true);
        const menuButton = foreground.getByRole('button', { name: 'Session', exact: true });
        await menuButton.click();
        // The same rows and icons as the session list's menu, with their shortcuts where a keyboard is likely.
        const menu = page.getByRole('dialog');
        const details = menu.getByRole('button', { name: /Details/ });
        await details.waitFor({ state: 'visible', timeout: 3_000 });
        if (viewport === MOBILE) {
            // A phone's card is titled with the session and drops the chords.
            const text = await details.innerText();
            expect(text).toContain('Details');
            expect(text).not.toMatch(/⌥|⌘|Ctrl|Alt/);
            await expect(page.getByTestId('session-actions-menu').getByText('Fix flaky auth timeout test', { exact: true }).count()).resolves.toBe(1);
        } else {
            await expect(details.innerText()).resolves.toMatch(/Details\s+(⌥⌘O|Ctrl\+Alt\+O)/);
        }
        await expect(menu.getByRole('button', { name: /Continue with…/ }).isVisible()).resolves.toBe(true);
        await expect(menu.getByRole('button', { name: /Archive/ }).isVisible()).resolves.toBe(true);
        // Anchored under the button, right-aligned to it.
        const [buttonBox, menuBox] = await Promise.all([menuButton.boundingBox(), details.boundingBox()]);
        expect(menuBox!.y).toBeGreaterThan(buttonBox!.y + buttonBox!.height - 1);
        await page.keyboard.press('Escape');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('archives from the header with one click on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'permission', viewport });
        const foreground = page.getByTestId('foreground-session');

        await foreground.getByRole('button', { name: 'Archive', exact: true }).click();

        await expect.poll(() => page.evaluate(() => (window as any).__SESSION_KILL_CALLS__ ?? [])).toEqual(['parent']);
        expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual([]);
        expect(await page.evaluate(() => (window as any).__HAPPYHERD_ALERTS__ ?? [])).toEqual([]);
        await expect(page.getByRole('dialog').count()).resolves.toBe(0);
        await expect(page.getByTestId('fixture-global-modal').count()).resolves.toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    // Real SessionView/header, SessionActionsPopover, FlatSessionRow and shared
    // archive hook; transport and storage boundary are this suite's fixtures.
    // sessionArchiving.test.ts separately covers the real storage list projection.
    it.each([DESKTOP, MOBILE].flatMap(viewport =>
        (['light', 'dark'] as const).flatMap(theme =>
            (['header', 'header-menu', 'row-menu'] as const).flatMap(entry =>
                [false, true].map(bot => ({ viewport, theme, entry, bot }))))))(
        'optimistically archives and retries $entry (bot=$bot) in $theme at $viewport.width px',
        async ({ viewport, theme, entry, bot }) => {
            const { page, errors } = await openScene({ scene: 'permission', viewport, theme, archiveJourney: true, botLifecycle: bot });
            const tray = page.getByTestId('archive-journey-row');
            const pressArchive = async () => {
                if (entry === 'header') {
                    await page.getByTestId('foreground-session').getByRole('button', { name: 'Archive', exact: true }).click();
                } else {
                    if (entry === 'row-menu') {
                        await tray.hover();
                        await tray.getByTestId('session-row-more').click();
                    } else {
                        await page.getByTestId('foreground-session').getByRole('button', { name: 'Session', exact: true }).click();
                    }
                    await page.getByRole('dialog').getByRole('button', { name: /Archive/ }).click();
                }
            };
            try {
                await tray.waitFor({ state: 'visible' });
                await pressArchive();
                await expect.poll(() => page.evaluate(() => (window as any).__ARCHIVE_KILL_PENDING__)).toBe(true);
                // The machine promise is deliberately unresolved: disappearance
                // cannot be explained by successful transport or a synced archive.
                await expect.poll(() => tray.count()).toBe(0);
                expect(await page.evaluate(() => (window as any).__SESSION_KILL_CALLS__)).toEqual(['parent']);
                expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual([]);
                expect(await page.evaluate(() => (window as any).__WORKTREE_CLEANUP_CALLS__?.length ?? 0)).toBe(bot ? 0 : 1);
                await evidence(page, `archive-pending-${entry}-${bot ? 'bot' : 'ordinary'}-${theme}-${viewport.width}`);

                // First failure: ordinary sessions try server fallback, bots do not.
                await page.evaluate(() => (window as any).__RESOLVE_ARCHIVE_KILL__(false));
                await tray.waitFor({ state: 'visible' });
                const alert = page.getByRole('alert');
                await alert.waitFor({ state: 'visible' });
                expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual(bot ? [] : ['parent']);
                await alert.getByRole('button', { name: 'OK', exact: true }).click();
                await evidence(page, `archive-rollback-${entry}-${bot ? 'bot' : 'ordinary'}-${theme}-${viewport.width}`);

                await page.evaluate(() => { (window as any).__ARCHIVE_FALLBACK_SUCCESS__ = true; });
                await pressArchive();
                await expect.poll(() => page.evaluate(() => (window as any).__SESSION_KILL_CALLS__?.length)).toBe(2);
                await expect.poll(() => tray.count()).toBe(0);
                expect(await page.evaluate(() => (window as any).__ARCHIVE_KILL_PENDING__)).toBe(true);
                // Ordinary retry proves successful server fallback; bot retry
                // succeeds only through its owning machine.
                await page.evaluate((success) => (window as any).__RESOLVE_ARCHIVE_KILL__(success), bot);
                await expect.poll(() => page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__?.length ?? 0)).toBe(bot ? 0 : 2);
                await settle(page);
                expect(await tray.count()).toBe(0);
                expect(await page.getByRole('alert').count()).toBe(0);
                expect(await page.evaluate(() => (window as any).__WORKTREE_CLEANUP_CALLS__?.length ?? 0)).toBe(bot ? 0 : 2);
                expect(errors).toEqual([]);
            } finally {
                // Release any pending fixture promise after an assertion fails;
                // do not strand transport work or change the existing timeout.
                await page.evaluate(() => (window as any).__RESOLVE_ARCHIVE_KILL__?.(true)).catch(() => {});
                await page.close();
            }
        }, 30_000,
    );

    it('toggles the Workspace beside the chat from the header without closing it', async () => {
        const { page, errors } = await openScene({ scene: 'permission', viewport: DESKTOP });
        const foreground = page.getByTestId('foreground-session');
        const toggle = foreground.getByRole('button', { name: 'Workspace', exact: true });
        await expect(toggle.getAttribute('aria-expanded')).resolves.toBe('false');
        await toggle.click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
        await toggle.click();
        await expect.poll(() => workspace.isVisible()).toBe(false);
        await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('expands a completed tool row in place with its diff on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'permission', viewport });
        const foreground = page.getByTestId('foreground-session');
        const row = foreground.getByRole('button', { name: /^Edited: .*session\.ts$/ });
        await row.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(row.getAttribute('aria-expanded')).resolves.toBe('false');
        await expect(row.innerText()).resolves.toMatch(/\+\d+\s+−\d+/);
        await row.click();
        await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true');
        const body = foreground.getByTestId('tool-line-body').first();
        await expect.poll(async () => (await body.boundingBox())?.height ?? 0, { timeout: 3_000 }).toBeGreaterThan(40);
        await expect(body.innerText()).resolves.toContain('isPrivateMode');
        await evidence(page, `tool-row-expanded-light-${viewport.width}`);
        await row.click();
        await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('answers a pending permission with its number key on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'permission', viewport });
        const card = page.getByTestId('tool-permission-card');
        await card.waitFor({ state: 'visible', timeout: 3_000 });
        await card.scrollIntoViewIfNeeded();
        for (const [index, label] of ['Yes', "Yes, don't ask again for this tool", 'No, and provide feedback'].entries()) {
            await expect(card.getByText(label, { exact: true }).isVisible()).resolves.toBe(true);
            await expect(card.getByText(String(index + 1), { exact: true }).isVisible()).resolves.toBe(true);
        }
        // Digits typed into the composer never answer the card.
        await page.locator('textarea').first().click();
        await page.keyboard.press('2');
        await expect(page.evaluate(() => (window as any).__PERMISSION_CALLS__ ?? [])).resolves.toEqual([]);
        await page.locator('textarea').first().fill('');
        await page.locator('body').click({ position: { x: 5, y: viewport.height / 2 } });
        await evidence(page, `permission-pending-light-${viewport.width}`);
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => (window as any).__PERMISSION_CALLS__ ?? [])).toEqual([
            ['allow', 'parent', 'perm-push'],
        ]);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('never answers a permission card the chat list has scrolled out of view', async () => {
        const { page, errors } = await openScene({ scene: 'permission', viewport: MOBILE });
        const card = page.getByTestId('tool-permission-card');
        await card.waitFor({ state: 'visible', timeout: 3_000 });
        // Scroll the chat back until the card sits just past the list's edge:
        // still mounted and inside the window, but clipped by the list.
        const geometry = await page.evaluate(() => {
            const node = document.querySelector('[data-testid="tool-permission-card"]') as HTMLElement;
            let list = node.parentElement;
            while (list && !(list.scrollHeight > list.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(list).overflowY))) {
                list = list.parentElement;
            }
            if (!list) return null;
            const target = list.getBoundingClientRect().bottom + 4;
            const start = list.scrollTop;
            const before = node.getBoundingClientRect().top;
            // Inverted lists move their rows the other way; probe the direction first.
            list.scrollTop = start + 10;
            const direction = Math.sign(node.getBoundingClientRect().top - before) || 1;
            list.scrollTop = start + direction * (target - before);
            const rect = node.getBoundingClientRect();
            return { top: rect.top, listBottom: list.getBoundingClientRect().bottom, windowHeight: window.innerHeight };
        });
        expect(geometry).not.toBeNull();
        expect(geometry!.top).toBeGreaterThanOrEqual(geometry!.listBottom);
        expect(geometry!.top).toBeLessThan(geometry!.windowHeight);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('1');
        await page.waitForTimeout(150);
        await expect(page.evaluate(() => (window as any).__PERMISSION_CALLS__ ?? [])).resolves.toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('answers a permission card that "Jump to latest" partly covers on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'permission-older', viewport });
        const card = page.getByTestId('tool-permission-card');
        await card.waitFor({ state: 'attached', timeout: 3_000 });
        // Only the top of the choices shows above the chat's bottom edge, and
        // "Jump to latest" sits over the middle of that visible part.
        const place = (search: boolean) => page.evaluate((fine) => {
            const node = document.querySelector('[data-testid="tool-permission-card"]') as HTMLElement;
            const yes = [...node.querySelectorAll('*')].find((element) => element.textContent === 'Yes' && element.children.length === 0)!;
            let choices = yes as HTMLElement;
            while (choices.parentElement !== node) choices = choices.parentElement!;
            let list = node.parentElement!;
            while (!(list.scrollHeight > list.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(list).overflowY))) list = list.parentElement!;
            const start = list.scrollTop;
            const before = choices.getBoundingClientRect().top;
            list.scrollTop = start + 10;
            // Inverted lists move their rows the other way.
            const direction = Math.sign(choices.getBoundingClientRect().top - before) || 1;
            list.scrollTop = start;
            const moveDown = (pixels: number) => { list.scrollTop += direction * pixels; };
            const jump = document.querySelector('[aria-label="Jump to latest"]');
            const centreCovered = () => {
                const box = choices.getBoundingClientRect();
                const edge = list.getBoundingClientRect().bottom;
                const bottom = Math.min(box.bottom, edge);
                if (bottom <= box.top) return false;
                const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + bottom) / 2);
                return Boolean(jump && hit && jump.contains(hit));
            };
            if (!fine) {
                moveDown(list.getBoundingClientRect().bottom - 140 - choices.getBoundingClientRect().top);
                return false;
            }
            moveDown(list.getBoundingClientRect().bottom - 140 - choices.getBoundingClientRect().top);
            for (let step = 0; step < 70 && !centreCovered(); step += 1) moveDown(2);
            return centreCovered();
        }, search);
        await place(false);
        await page.getByRole('button', { name: 'Jump to latest' }).waitFor({ state: 'visible', timeout: 3_000 });
        await expect(place(true)).resolves.toBe(true);
        await expect(card.getByText('Yes', { exact: true }).isVisible()).resolves.toBe(true);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => (window as any).__PERMISSION_CALLS__ ?? [])).toEqual([
            ['allow', 'parent', 'perm-push'],
        ]);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('opens composer chip pickers anchored to their chip on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'permission', viewport });
        const foreground = page.getByTestId('foreground-session');
        const agent = foreground.getByTestId('composer-chip-agent');
        const permission = foreground.getByTestId('composer-chip-permission');
        await expect(agent.isVisible()).resolves.toBe(true);
        await expect(permission.isVisible()).resolves.toBe(true);
        // The chip names the harness as the mock does (UI overhaul).
        await expect(agent.innerText()).resolves.toContain('Claude');
        await expect(agent.innerText()).resolves.not.toContain('Claude Code');
        const model = foreground.getByTestId('composer-chip-model');
        const effort = foreground.getByTestId('composer-chip-effort');
        if (viewport === MOBILE) {
            // Phones keep all four chips on a sideways-scrolling row of their own, above the + button.
            await expect(effort.isVisible()).resolves.toBe(true);
            const row = foreground.getByTestId('composer-phone-chips');
            const [rowBox, plusBox] = await Promise.all([row.boundingBox(), foreground.getByTestId('mobile-composer-actions-trigger').boundingBox()]);
            expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(plusBox!.y + 1);
            await expect(row.evaluate((element) => {
                const scroller = element.firstElementChild instanceof HTMLElement && element.scrollWidth <= element.clientWidth
                    ? element.firstElementChild
                    : element;
                return getComputedStyle(scroller).overflowX;
            })).resolves.toMatch(/auto|scroll/);
        }
        {
            // This offline fixture has no advertised display name: keep the exact model ID.
            await expect(model.innerText()).resolves.toBe('claude-opus-5-5');
            await model.click();
            const popover = foreground.getByTestId('composer-chip-popover-model');
            await popover.waitFor({ state: 'visible', timeout: 3_000 });
            await expect(popover.getByRole('button', { name: 'claude-sonnet-5', exact: true }).isVisible()).resolves.toBe(true);
            const [chipBox, popoverBox] = await Promise.all([model.boundingBox(), popover.boundingBox()]);
            expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(chipBox!.y);
            if (viewport === MOBILE) {
                // Phones: the picker spans the composer card, over its chip row (measured once its pop-in settles).
                await popover.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
                const [settled, composer] = await Promise.all([popover.boundingBox(), foreground.getByTestId('composer-phone-chips').boundingBox()]);
                expect(Math.abs(settled!.x - composer!.x)).toBeLessThanOrEqual(1);
                expect(Math.abs(settled!.width - composer!.width)).toBeLessThanOrEqual(2);
            } else {
                expect(Math.abs(popoverBox!.x - chipBox!.x)).toBeLessThan(24);
            }
            await evidence(page, `composer-model-popover-light-${viewport.width}`);
            await popover.getByRole('button', { name: 'claude-sonnet-5', exact: true }).click();
            await expect.poll(() => page.evaluate(() => (window as any).__SESSION_MODE_MUTATIONS__ ?? [])).toContainEqual(
                { sessionId: 'parent', patch: expect.objectContaining({ modelMode: 'claude-sonnet-5' }) },
            );
            await expect.poll(() => popover.count()).toBe(0);
        }
        await permission.click();
        const permissionPopover = foreground.getByTestId('composer-chip-popover-permission-chip');
        await permissionPopover.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(permissionPopover.getByText('PERMISSION MODE', { exact: true }).isVisible()).resolves.toBe(true);
        await evidence(page, `composer-permission-popover-light-${viewport.width}`);
        // Global navigation treats an unhandled Escape keydown as Back; the picker must consume it.
        await page.evaluate(() => window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) (window as any).__ESCAPE_BACK__ = ((window as any).__ESCAPE_BACK__ ?? 0) + 1;
        }));
        await page.keyboard.press('Escape');
        await expect.poll(() => permissionPopover.count()).toBe(0);
        await expect(page.evaluate(() => (window as any).__ESCAPE_BACK__ ?? 0)).resolves.toBe(0);
        // The agent chip opens the existing "Continue with…" sheet.
        await agent.click();
        await page.getByTestId('fixture-global-modal').waitFor({ state: 'attached', timeout: 3_000 });
        expect(errors).toEqual([]);
        await page.close();
    }, 40_000);

    it('puts the phone session on the 16 px gutter: stream, dock and composer', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await openScene({ scene: 'permission', viewport: MOBILE, theme });
            await page.waitForTimeout(600);
            const edges = await page.getByTestId('foreground-session').evaluate((root) => {
                const leaf = (text: string) => [...root.querySelectorAll('*')]
                    .find((node) => node.children.length === 0 && node.textContent?.trim().startsWith(text)) as HTMLElement | undefined;
                const drawn = (node: Element | null | undefined): number | null => {
                    for (let box = node; box && box !== root; box = box.parentElement) {
                        const cs = getComputedStyle(box);
                        if (cs.borderLeftWidth !== '0px' && cs.borderLeftColor !== 'rgba(0, 0, 0, 0)') return Math.round(box.getBoundingClientRect().left);
                    }
                    return null;
                };
                const left = (node: Element | null | undefined) => node ? Math.round(node.getBoundingClientRect().left) : null;
                const readRow = leaf('Read')?.closest('[aria-label], [data-testid]')?.querySelector('*');
                return {
                    toolRowIcon: left(readRow),
                    permissionCard: drawn(leaf('Terminal')),
                    queue: drawn(leaf('Verify the fix')),
                    composerCard: drawn(root.querySelector('[data-testid="composer-phone-chips"]')),
                    composerPlus: left(root.querySelector('[data-testid="mobile-composer-actions-trigger"]')),
                };
            });
            expect(edges).toEqual({ toolRowIcon: 16, permissionCard: 16, queue: 16, composerCard: 16, composerPlus: 16 + 1 + 16 });
            await evidence(page, `session-phone-gutter-${theme}-390`);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('widens the phone Side chats button just enough to hold its count', async () => {
        const { page, errors } = await openScene({ scene: 'permission', viewport: MOBILE });
        const geometry = await page.getByTestId('session-header-side-chats').evaluate((target) => {
            // On phones the 44 px target wraps the drawn button, the one with the hairline border.
            const drawn = [target, ...target.querySelectorAll('*')].find((node) => (
                getComputedStyle(node).borderTopWidth === '1px'
            )) as HTMLElement;
            const count = [...drawn.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent === '2')!;
            const badge = count.parentElement!;
            const icon = drawn.firstElementChild!;
            const box = (node: Element) => {
                const rect = node.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
            };
            return { drawn: box(drawn), badge: box(badge), icon: box(icon) };
        });
        // The badge sits inside the border with room to spare, after the icon.
        expect(geometry.badge.right).toBeLessThanOrEqual(geometry.drawn.right - 4);
        expect(geometry.icon.right).toBeLessThanOrEqual(geometry.badge.left);
        expect(geometry.icon.left).toBeGreaterThanOrEqual(geometry.drawn.left + 4);
        // Slightly wider than the 36 px icon buttons, and just as tall.
        expect(geometry.drawn.width).toBeGreaterThan(36);
        expect(geometry.drawn.width).toBeLessThanOrEqual(60);
        expect(geometry.drawn.height).toBe(36);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ])('keeps a one-word message on one line and long ones within the bubble limit on %s', async (_label, viewport) => {
        const { page, errors } = await openScene({ scene: 'short-reply', viewport });
        const bubbles = await page.getByTestId('foreground-session').evaluate((root) => {
            const measure = (text: string) => {
                const leaf = [...root.querySelectorAll('*')]
                    .find((node) => node.children.length === 0 && node.textContent?.trim() === text) as HTMLElement | undefined;
                if (!leaf) return null;
                const range = document.createRange();
                range.selectNodeContents(leaf);
                const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
                // The bubble is the nearest ancestor with the hairline border.
                let bubble: HTMLElement | null = leaf;
                while (bubble && getComputedStyle(bubble).borderTopWidth !== '1px') bubble = bubble.parentElement;
                return { lines, width: bubble ? bubble.getBoundingClientRect().width : null };
            };
            return {
                short: measure('continue'),
                long: measure('Also verify on mobile Safari before committing.'),
                row: (root as HTMLElement).getBoundingClientRect().width,
            };
        });
        expect(bubbles.short).toMatchObject({ lines: 1 });
        expect(bubbles.long?.width).not.toBeNull();
        // Long messages keep the 88% / 640 px limit of the chat's row (16 px gutters).
        const limit = Math.min(0.88 * (bubbles.row - 32), 640);
        expect(bubbles.long!.width!).toBeLessThanOrEqual(limit + 1);
        if (viewport === MOBILE) expect(bubbles.long!.lines).toBeGreaterThan(1);
        await evidence(page, `session-short-reply-${viewport.width}`);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ])('shows a pending Skill permission as an answerable card on %s', async (_label, viewport) => {
        const { page, errors } = await openScene({ scene: 'skill-permission', viewport });
        const card = page.getByTestId('tool-permission-card');
        await card.waitFor({ state: 'visible' });
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByText('workspace-manage-tasks').count()).resolves.toBeGreaterThan(0);
        for (const [index, label] of ['Yes', "Yes, don't ask again for this tool", 'No, and provide feedback'].entries()) {
            await expect(card.getByText(label, { exact: true }).isVisible()).resolves.toBe(true);
            await expect(card.getByText(String(index + 1), { exact: true }).isVisible()).resolves.toBe(true);
        }
        await evidence(page, `session-skill-permission-${viewport.width}`);
        // The number key answers it like any other permission request.
        await page.locator('body').click({ position: { x: 5, y: viewport.height / 2 } });
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => (window as any).__PERMISSION_CALLS__ ?? [])).toEqual([
            ['allow', 'parent', 'perm-skill'],
        ]);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('reopens a finished turn from its "Worked …" row', async () => {
        const { page, errors } = await openScene({ scene: 'permission', viewport: DESKTOP });
        const foreground = page.getByTestId('foreground-session');
        const worked = foreground.getByRole('button', { name: /^Worked / }).first();
        await worked.scrollIntoViewIfNeeded();
        await expect(worked.getAttribute('aria-expanded')).resolves.toBe('false');
        await expect(foreground.getByText('I will trace the timeout path first.').count()).resolves.toBe(0);
        await worked.click();
        await foreground.getByText('I will trace the timeout path first.').waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByTestId('todo-card').isVisible()).resolves.toBe(true);
        await expect(foreground.getByTestId('todo-card').innerText()).resolves.toContain('2/3');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['Web Desktop', DESKTOP],
        ['Web Mobile', MOBILE],
    ] as const)('shows the inline question as an info card with Other, Cancel and Submit on %s', async (_surface, viewport) => {
        const { page, errors } = await openScene({ scene: 'question', viewport });
        const card = page.getByTestId('question-form-card');
        await card.waitFor({ state: 'visible', timeout: 3_000 });
        await card.getByText('All supported engines', { exact: true }).click();
        await expect(card.getByRole('radio', { checked: true }).count()).resolves.toBe(1);
        await expect(card.getByPlaceholder('Type your answer...').isVisible()).resolves.toBe(true);
        await expect(card.getByRole('button', { name: 'Cancel' }).isVisible()).resolves.toBe(true);
        await expect(card.getByRole('button', { name: 'Submit Answer' }).isVisible()).resolves.toBe(true);
        await evidence(page, `question-selected-light-${viewport.width}`);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    // Review screenshots for the parent's side-by-side comparison with the mock.
    it.runIf(Boolean(evidenceDir)).each([
        ['permission', 'light', DESKTOP], ['permission', 'dark', DESKTOP],
        ['permission', 'light', MOBILE], ['permission', 'dark', MOBILE],
        ['question', 'light', DESKTOP], ['question', 'dark', DESKTOP],
        ['question', 'light', MOBILE], ['question', 'dark', MOBILE],
    ] as const)('captures the %s scene in %s at %o', async (scene, theme, viewport) => {
        const { page, errors } = await openScene({ scene, viewport, theme });
        await evidence(page, `session-${scene}-${theme}-${viewport.width}`);
        if (scene === 'permission') {
            await page.getByTestId('foreground-session').getByRole('button', { name: /^Worked / }).first().click();
            await evidence(page, `session-${scene}-worked-open-${theme}-${viewport.width}`);
        }
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);
});
