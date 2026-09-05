import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const octiconsFontPath = resolve(
    appRoot,
    '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Octicons.ttf',
);
const octiconsGlyphMapPath = resolve(
    appRoot,
    '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Octicons.json',
);

const virtualModules: Record<string, string> = {
    'react-native-unistyles': `
        const dark = new URLSearchParams(window.location.search).get('theme') === 'dark';
        const colors = new Proxy({
            text: dark ? '#f5f2e8' : '#111', textSecondary: dark ? '#b8b2a4' : '#666', textDestructive: dark ? '#ff8178' : '#c00', textLink: dark ? '#f3c969' : '#06c',
            divider: dark ? '#4b463d' : '#ddd', surface: dark ? '#161512' : '#fff', surfaceHigh: dark ? '#27241e' : '#f3f3f3', warning: '#a60',
            groupped: { background: dark ? '#0f0f0d' : '#f5f5f5' }, input: { background: dark ? '#27241e' : '#eee' },
            header: { background: dark ? '#161512' : '#fff', tint: dark ? '#f5f2e8' : '#111' },
            button: { primary: { background: dark ? '#f3c969' : '#111', tint: dark ? '#17140c' : '#fff' } },
            success: '#0a0', surfaceSelected: dark ? '#302d26' : '#eee',
            glass: { overlay: dark ? '#161512' : '#fff', overlayTint: dark ? '#f5f2e8' : '#fff', backgroundStrong: dark ? '#161512' : '#fff', border: dark ? '#4b463d' : '#ddd' },
            shadow: { color: '#000', opacity: 0.2 },
        }, { get: (target, key) => target[key] ?? (dark ? '#f5f2e8' : '#111') });
        const theme = { dark, colors };
        export const StyleSheet = {
            hairlineWidth: 1,
            absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
            create: (factory) => typeof factory === 'function' ? factory(theme) : factory,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        import octiconsFontUrl from ${JSON.stringify(octiconsFontPath)};
        import octiconsGlyphMap from ${JSON.stringify(octiconsGlyphMapPath)};
        const glyph = {
            'chevron-back': '‹',
            'chevron-forward': '›',
            'chevron-left': '‹',
            plus: '+',
            x: '×',
        };
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name }, glyph[name] ?? '•');
        Icon.glyphMap = {};
        const Octicon = ({ name, size, color }) => React.createElement(
            React.Fragment,
            null,
            React.createElement(
                'style',
                null,
                '@font-face{font-family:HappyHerdTestOcticons;src:url("' + octiconsFontUrl + '") format("truetype")}',
            ),
            React.createElement(
                'span',
                {
                    'data-icon': name,
                    style: { color, fontFamily: 'HappyHerdTestOcticons', fontSize: size, lineHeight: 1 },
                },
                String.fromCodePoint(octiconsGlyphMap[name]),
            ),
        );
        Octicon.glyphMap = octiconsGlyphMap;
        export const Ionicons = Icon;
        export const Octicons = Octicon;
    `,
    'expo-image': `
        import React from 'react';
        export const Image = ({ source, style, testID }) => React.createElement('img', {
            src: typeof source === 'string' ? source : source?.uri,
            style,
            'data-testid': testID,
            'data-image': 'true',
            alt: '',
        });
    `,
    'expo-linear-gradient': `
        import React from 'react';
        import { View } from 'react-native';
        export const LinearGradient = ({ children, style }) => React.createElement(View, { style }, children);
    `,
    'react-native-reanimated': `
        import React from 'react';
        import { View } from 'react-native';
        const Animated = { View };
        export default Animated;
        export const useSharedValue = (value) => ({ value });
        export const useAnimatedStyle = (factory) => factory();
        export const withTiming = (value) => value;
        export const Easing = { out: (value) => value, cubic: 'cubic' };
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'expo-router': `
        import React from 'react';
        export const useRouter = () => ({
            back() { window.__ROUTER_BACK_COUNT__ = (window.__ROUTER_BACK_COUNT__ ?? 0) + 1; },
            push() {},
        });
        export const useLocalSearchParams = () => ({});
        export const Stack = { Screen: () => null };
    `,
    'expo-router/drawer': `
        import React from 'react';
        import { View } from 'react-native';
        import { ChatHeaderView } from '@/components/ChatHeaderView';
        export const Drawer = ({ screenOptions, drawerContent }) => {
            const drawerWidth = screenOptions.drawerStyle.width;
            return React.createElement(
                React.Fragment,
                null,
                React.createElement(
                    View,
                    {
                        testID: 'navigation-drawer',
                        style: [{ position: 'absolute', top: 0, bottom: 0, left: 0 }, screenOptions.drawerStyle],
                    },
                    drawerContent ? drawerContent() : null,
                ),
                React.createElement(
                    View,
                    {
                        testID: 'navigation-screen',
                        style: { position: 'absolute', top: 0, right: 0, bottom: 0, left: drawerWidth },
                    },
                    React.createElement(ChatHeaderView, {
                        folderName: 'demo-project',
                        title: 'Collapsed navigation fixture',
                        onTitlePress: () => {
                            window.__SESSION_TITLE_PRESS_COUNT__ = (window.__SESSION_TITLE_PRESS_COUNT__ ?? 0) + 1;
                        },
                    }),
                ),
            );
        };
    `,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: true });`,
    '@/components/SidebarView': `
        import React from 'react';
        export const SidebarView = () => React.createElement(
            'div',
            {
                'data-testid': 'sidebar-content',
                style: { height: '100%', padding: 20, paddingTop: 72, background: '#f5f5f5', color: '#555' },
            },
            'HappyHerd navigation',
        );
    `,
    '@/sync/storage': `
        import React from 'react';
        const settings = {
            navigationSidebarCollapsed: false,
            zenMode: false,
            machineWorkspace: true,
            recentMachinePaths: [],
            favoriteMachinePaths: [],
        };
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        const session = {
            id: 'ordinary-session',
            metadata: { path: '/workspace', host: 'fixture', machineId: 'machine-1', flavor: 'claude' },
        };
        const machines = [
            { id: 'machine-1', active: true, metadata: { supportsFileDelete: true, homeDir: '/workspace', host: 'session' } },
            { id: 'machine-2', active: true, metadata: { supportsFileDelete: true, homeDir: '/machine-root', host: 'remote' } },
        ];
        const gitStatus = { lastUpdatedAt: 'fixture', linesAdded: 0, linesRemoved: 0 };
        const gitStatusFiles = { stagedFiles: [], unstagedFiles: [] };
        const projectFiles = { files: [{ fullPath: '/workspace/sidebar.md' }] };
        export const useLocalSetting = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        export const useSetting = (key) => settings[key];
        export const useLocalSettingMutable = (key) => [
            React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]),
            (value) => { settings[key] = value; emit(); },
        ];
        export const useSession = (id) => id === session.id ? session : null;
        export const useSessionGitStatus = () => gitStatus;
        export const useSessionGitStatusFiles = () => gitStatusFiles;
        export const useSessionProjectFiles = () => projectFiles;
        export const useMachine = (id) => machines.find((machine) => machine.id === id) ?? null;
        export const useAllMachines = () => machines;
        export const storage = { getState: () => ({
            settings,
            sessions: { [session.id]: session },
            machines: Object.fromEntries(machines.map((machine) => [machine.id, machine])),
            pathProjectFiles: { fixture: projectFiles },
            getSessionPathKey: () => 'fixture',
            applyGitStatusFiles() {},
            applyProjectFiles() {},
        }) };
    `,
    '@/utils/responsive': `
        export const useHeaderHeight = () => 64;
        export const useIsTablet = () => true;
    `,
    '@/utils/isTauri': `export const isTauri = () => false;`,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/hooks/useTauriZoom': `export const DEFAULT_APP_ZOOM = 1;`,
    '@/navigation/browserNavigation': `
        export const canRouteForward = () => false;
        export const canUseRouteBack = () => !new URLSearchParams(window.location.search).has('back-disabled');
        export const getNavigatorCanGoBack = () => true;
    `,
    '@/navigation/browserNavigationStore': `
        const state = {
            routeHistory: {},
            markRouteBack() { window.__ROUTE_BACK_MARK_COUNT__ = (window.__ROUTE_BACK_MARK_COUNT__ ?? 0) + 1; },
            markRouteForward() {},
        };
        export const useBrowserNavigationStore = (selector) => selector(state);
        useBrowserNavigationStore.getState = () => state;
    `,
    '@/-session/sessionOverlayNav': `
        const state = {
            canBack: !new URLSearchParams(window.location.search).has('back-disabled'),
            canForward: false,
            back: () => {
                if (window.__OVERLAY_BACK_ENABLED__ === false) return false;
                window.__OVERLAY_BACK_COUNT__ = (window.__OVERLAY_BACK_COUNT__ ?? 0) + 1;
                return true;
            },
            forward: () => false,
        };
        export const useOverlayNav = (selector) => selector(state);
        useOverlayNav.getState = () => state;
    `,
    '@/components/StyledText': `
        import React from 'react';
        import { Text as NativeText } from 'react-native';
        export const Text = (props) => React.createElement(NativeText, props, props.children);
    `,
    '@/constants/Typography': `export const Typography = { default: () => ({}), mono: () => ({}) };`,
    '@/components/FileIcon': `
        import React from 'react';
        export const FileIcon = () => React.createElement('span', { 'data-file-icon': 'true' }, '▧');
    `,
    'expo-clipboard': `export const setStringAsync = async (value) => { window.__CLIPBOARD_TEXT__ = value; };`,
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
        const content = btoa('# Desktop workspace\\n\\n- First review line\\n- Second review line\\n\\n' + String.fromCharCode(96, 96, 96) + 'ts\\nconst answer = 42;\\n' + String.fromCharCode(96, 96, 96) + '\\n\\n[Open session relative](notes/session-child.md)\\n');
        const machineMarkdown = btoa('# Machine workspace\\n\\n[Open machine relative](notes/machine-child.md)\\n');
        const sourceMarkdown = btoa('# Source review\\n\\n' + 'long-markdown-'.repeat(120));
        const source = btoa('const first = 1;\\n\\nconst longValue = "' + 'long-value-'.repeat(120) + '";\\nconst last = 2;');
        const navigationSource = btoa(Array.from({ length: 260 }, (_, index) => 'const line' + (index + 1) + ' = ' + (index + 1) + ';').join('\\n'));
        const canvas = btoa(JSON.stringify({
            nodes: [
                { id: 'text-node', type: 'text', text: '# Start', x: 0, y: 0, width: 220, height: 120 },
                { id: 'file-node', type: 'file', file: 'notes/My (draft) [v2].md', x: 320, y: 0, width: 260, height: 120 },
            ],
            edges: [{ id: 'edge', fromNode: 'text-node', toNode: 'file-node', label: 'next' }],
        }));
        const taskHtml = btoa([
            '<!doctype html><html><head><title>Task review board</title></head><body>',
            '<h1>Task review board</h1>',
            '<button id="show-open" type="button" onclick="window.renderTasks(&quot;open&quot;)">Show open</button>',
            '<button id="show-all" type="button" onclick="window.reviewTasks=[{title:&quot;Review launch&quot;,open:true},{title:&quot;Archive notes&quot;,open:false}];window.renderTasks=(filter)=>{const visible=filter===&quot;open&quot;?window.reviewTasks.filter((task)=>task.open):window.reviewTasks;document.getElementById(&quot;task-summary&quot;).textContent=filter===&quot;open&quot;?visible.length+&quot; open task&quot;:visible.length+&quot; tasks&quot;;const cards=document.getElementById(&quot;task-cards&quot;);cards.replaceChildren();visible.forEach((task)=>{const card=document.createElement(&quot;article&quot;);card.dataset.testid=&quot;task-card&quot;;card.textContent=task.title;cards.append(card);});};window.renderTasks(&quot;all&quot;)">Show all</button>',
            '<p id="task-summary">Scripts have not run</p>',
            '<div id="task-cards"></div>',
            '</body></html>',
        ].join(''));
        export const machineDeleteFile = async () => ({ success: true });
        export const machineGetDirectoryTree = async (machineId, path, depth) => {
            window.__MACHINE_DIRECTORY_CALLS__ = [...(window.__MACHINE_DIRECTORY_CALLS__ ?? []), { machineId, path, depth }];
            if (machineId !== 'machine-2' || path !== '/machine-root' || depth !== 1) {
                return { success: false, error: 'Unexpected Workspace request' };
            }
            return {
                success: true,
                tree: {
                    type: 'directory',
                    name: 'machine-root',
                    path: '/machine-root',
                    children: [
                        { type: 'directory', name: 'project', path: '/machine-root/project', children: [] },
                        { type: 'file', name: 'remote.md', path: '/machine-root/remote.md', size: 23 },
                        { type: 'file', name: 'second.md', path: '/machine-root/second.md', size: 19 },
                    ],
                },
            };
        };
        export const machineCreateDirectory = async () => ({ success: false, error: 'Not implemented by fixture' });
        export const machineReadFile = async (machineId, path) => {
            window.__MACHINE_READ_CALLS__ = [...(window.__MACHINE_READ_CALLS__ ?? []), { machineId, path }];
            if (machineId === 'machine-2' && path === '/machine-root/machine.md') {
                return { success: true, content: machineMarkdown };
            }
            return machineId === 'machine-2' && (
                path === '/machine-root/remote.md' || path === '/machine-root/second.md'
            )
                ? { success: true, content }
                : { success: false, error: 'Unexpected Workspace read' };
        };
        export const machineWriteFile = async () => ({ success: true, hash: 'saved-hash' });
        export const machineReadFileWithinRoot = async () => ({ success: false, error: 'No image fixture' });
        export const sessionReadFile = async (_sessionId, path) => ({
            success: true,
            content: path === '/workspace/task.html'
                ? taskHtml
                : path === '/workspace/review.canvas'
                    ? canvas
                    : path === '/workspace/review.ts'
                        ? source
                        : path === '/workspace/navigation.ts' ? navigationSource
                            : path === '/workspace/source.md' ? sourceMarkdown : content,
        });
        export const sessionWriteFile = async (_sessionId, path, content) => {
            window.__SESSION_WRITE_CALLS__ = [...(window.__SESSION_WRITE_CALLS__ ?? []), { path, content }];
            return { success: true, hash: 'saved-hash' };
        };
        export const sessionDeleteFile = async () => {
            window.__DELETE_RPC_COUNT__ = (window.__DELETE_RPC_COUNT__ ?? 0) + 1;
            return { success: true };
        };
    `,
    '@/components/AgentInputAttachmentStrip': `export const AgentInputAttachmentStrip = () => null;`,
    '@/modal': `
        export const Modal = {
            alert() {},
            confirm: async () => true,
        };
    `,
    '@/sync/sync': `
        let feedbackAttempt = 0;
        export const sync = {
            applySettings() {},
            sendMessage: async (sessionId, text, options) => {
                feedbackAttempt += 1;
                window.__WORKSPACE_FEEDBACK_CALLS__ = [
                    ...(window.__WORKSPACE_FEEDBACK_CALLS__ ?? []),
                    { sessionId, text, options },
                ];
                if (new URLSearchParams(window.location.search).has('feedback-fail-once') && feedbackAttempt === 1) {
                    window.__WORKSPACE_FEEDBACK_FAILURE_COUNT__ = (window.__WORKSPACE_FEEDBACK_FAILURE_COUNT__ ?? 0) + 1;
                    throw new Error('Fixture feedback send failed once');
                }
                return { localId: 'feedback-local-id' };
            },
        };
    `,
    '@/sync/apiSocket': `
        const encode = (value) => btoa(value);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>';
        const responses = {
            'http://localhost:3000/live': {
                type: 'text/html; charset=utf-8',
                finalUrl: 'http://127.0.0.1:4000/redirected/index.html',
                body: '<!doctype html><html><head><style>#inline-target{width:2px;height:2px;background-image:url(http://127.0.0.1:4000/redirected/inline.svg)}</style><link rel="stylesheet" href=http://127.0.0.1:4000/redirected/live.css></head><body><main><div id="inline-target"></div><img id="unquoted-target" alt="" src=http://127.0.0.1:4000/redirected/unquoted.svg><img id="srcset-target" alt="" srcset="http://127.0.0.1:4000/redirected/srcset.svg 1x"><button id="live-target">Waiting for network</button></main><script src="./live.js"></script></body></html>',
            },
            'http://127.0.0.1:4000/redirected/live.css': {
                type: 'text/css; charset=utf-8',
                body: 'main{position:relative;min-width:800px;min-height:420px}#live-target{display:inline-flex;position:absolute;left:520px;top:120px;padding:12px 18px;background-color:rgb(25,90,180);background-image:url("./css-bg.svg");color:white;border:0;border-radius:8px}',
            },
            'http://127.0.0.1:4000/redirected/live.js': {
                type: 'text/javascript; charset=utf-8',
                body: 'window.__LIVE_SCRIPT_RAN__=true;const dynamicImage=document.createElement("img");dynamicImage.src="http://127.0.0.1:4000/redirected/dynamic.svg";document.body.appendChild(dynamicImage);const dynamicStyle=document.createElement("div");dynamicStyle.style.backgroundImage="url(http://127.0.0.1:4000/redirected/dynamic-style.svg)";dynamicStyle.style.width="2px";dynamicStyle.style.height="2px";document.body.appendChild(dynamicStyle);fetch("./api/state").then((response)=>response.text()).then((text)=>{document.getElementById("live-target").textContent=text;});',
            },
            'http://127.0.0.1:4000/redirected/api/state': {
                type: 'text/plain; charset=utf-8',
                body: 'Live from machine-2',
            },
            'http://127.0.0.1:4000/redirected/css-bg.svg': { type: 'image/svg+xml', body: svg },
            'http://127.0.0.1:4000/redirected/inline.svg': { type: 'image/svg+xml', body: svg },
            'http://127.0.0.1:4000/redirected/unquoted.svg': { type: 'image/svg+xml', body: svg },
            'http://127.0.0.1:4000/redirected/srcset.svg': { type: 'image/svg+xml', body: svg },
            'http://127.0.0.1:4000/redirected/dynamic.svg': { type: 'image/svg+xml', body: svg },
            'http://127.0.0.1:4000/redirected/dynamic-style.svg': { type: 'image/svg+xml', body: svg },
        };
        export const apiSocket = {
            machineRPC: async (machineId, method, request) => {
                window.__WORKSPACE_LIVE_RPC_CALLS__ = [
                    ...(window.__WORKSPACE_LIVE_RPC_CALLS__ ?? []),
                    { machineId, method, url: request.url },
                ];
                const fixture = responses[request.url];
                if (machineId !== 'machine-2' || method !== 'workspace-live-fetch' || !fixture) {
                    return { success: false, code: 'request-failed', error: 'Unexpected live request' };
                }
                return {
                    success: true,
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': fixture.type },
                    body: encode(fixture.body),
                    finalUrl: fixture.finalUrl ?? request.url,
                };
            },
        };
    `,
    '@/sync/workspaceContext': `
        export const MAX_WORKSPACE_CONTEXT_ITEMS = 8;
        const entries = new Map();
        const empty = [];
        const listeners = new Set();
        export const workspaceContextEntryKey = (entry) => JSON.stringify(entry.source.kind === 'machine'
            ? ['machine', entry.source.machineId, entry.path]
            : ['session', entry.path]);
        export const getWorkspaceContextEntries = (sessionId) => entries.get(sessionId) ?? empty;
        export const subscribeWorkspaceContext = (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        };
        export const addWorkspaceContextEntry = (sessionId, entry) => {
            const current = entries.get(sessionId) ?? [];
            const key = workspaceContextEntryKey(entry);
            entries.set(sessionId, [...current.filter((candidate) => workspaceContextEntryKey(candidate) !== key), entry]);
            window.__WORKSPACE_CONTEXT_CALLS__ = [...(window.__WORKSPACE_CONTEXT_CALLS__ ?? []), { action: 'add', sessionId, entry }];
            listeners.forEach((listener) => listener());
            return true;
        };
        export const removeWorkspaceContextEntry = (sessionId, entryOrPath) => {
            entries.set(sessionId, (entries.get(sessionId) ?? []).filter((entry) => typeof entryOrPath === 'string'
                ? entry.path !== entryOrPath
                : workspaceContextEntryKey(entry) !== workspaceContextEntryKey(entryOrPath)));
            window.__WORKSPACE_CONTEXT_CALLS__ = [...(window.__WORKSPACE_CONTEXT_CALLS__ ?? []), { action: 'remove', sessionId, entryOrPath }];
            listeners.forEach((listener) => listener());
        };
    `,
    '@/hooks/useMachineFileUpload': `
        export const useMachineFileUpload = () => ({
            state: { phase: 'idle', completed: 0, total: 0, currentFile: null, error: null, target: null },
            reset() {}, pickAndUpload: async () => [], canCancel: false, canRetry: false, cancel() {}, retry: async () => [],
        });
    `,
    '@/hooks/useImagePicker': `
        export const useImagePicker = () => ({
            selectedImages: [],
            pickImages: async () => undefined,
            removeImage() {},
            clearImages() {},
            addImages() {},
        });
    `,
    '@/hooks/useVoiceInputAvailability': `
        export const useVoiceInputAvailability = () => ({ configured: false, loading: false, available: false });
    `,
    '@/hooks/useVoiceDictation': `
        export const useVoiceDictation = () => ({
            phase: 'idle', error: null, toggle() {}, cancel() {}, retry() {}, canRetry: false,
        });
    `,
    '@/components/MachineFileUploadStatus': `export const MachineFileUploadStatus = () => null;`,
    '@/components/SideChatPanel': `export const SideChatPanel = () => null;`,
    '@/components/AnimatedOverlay': `
        export const AnimatedClickAwayBackdrop = () => null;
        export const AnimatedPopup = ({ children }) => children;
        export const LocalBlurHalo = () => null;
    `,
    '@/components/MobileGlass': `export const MobileGlassSurface = ({ children }) => children;`,
    '@/components/BubblePressable': `export const BubblePressable = () => null;`,
    '@/components/navigation/MobileHeaderScrim': `
        export const MobileHeaderScrim = () => null;
        export const MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY = 0.8;
        export const MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY = 0.96;
    `,
    '@/keyboard/shortcuts': `
        export const getPreferredShortcutModifier = () => 'Meta';
        export const formatShortcutChord = () => '';
        export const matchesShortcutChord = () => false;
        export const SIDEBAR_PICKER_SHORTCUTS = { changes: [], allFiles: [], newSideChat: [] };
    `,
    '@/sync/gitStatusFiles': `export const getGitStatusFiles = async () => ({ stagedFiles: [], unstagedFiles: [] });`,
    '@/sync/projectFiles': `export const getProjectFiles = async () => ({ files: [{ fullPath: '/workspace/sidebar.md' }] });`,
    '@/components/WorkspaceLinkViewer': `export const WorkspaceLinkViewer = () => null;`,
    '@/components/WorkspaceLinkViewerModel': `export const workspaceLinkViewerKey = () => 'fixture';`,
    '@/-session/workspaceLinkNavigation': `
        import React from 'react';
        export const dismissWorkspaceLinkToOrigin = () => undefined;
        export const useWorkspaceLinkDismissGuard = () => ({ onSendingChange() {}, onDirtyChange() {}, guardDismiss: (action) => action() });
        const recordLink = (route) => {
            window.__WORKSPACE_LINK_CALLS__ = [...(window.__WORKSPACE_LINK_CALLS__ ?? []), route];
        };
        export const WorkspaceLinkPressContext = React.createContext(recordLink);
        export const useWorkspaceLinkPress = () => React.useContext(WorkspaceLinkPressContext);
    `,
    '@/components/layout': `export const layout = { maxWidth: 1200, headerMaxWidth: 800 };`,
    '@/text': `
        export const t = (key, params) => ({
            'common.back': 'Back',
            'common.cancel': 'Cancel',
            'common.delete': 'Delete',
            'common.error': 'Error',
            'common.loading': 'Sending',
            'common.save': 'Save',
            'files.changes': 'Changes',
            'files.noChangesTitle': 'No changes',
            'files.noChangesSubtitle': 'No changed files in this session.',
            'files.searchPlaceholder': 'Search files',
            'files.addPanel': 'Add panel',
            'files.cannotDisplayBinary': 'Cannot display binary',
            'files.closeFileTab': 'Close ' + (params?.name ?? ''),
            'files.deleteFile': 'Delete',
            'files.deleteFileDescription': 'This permanently removes the selected file.',
            'files.deleteFileTitle': 'Delete file?',
            'files.editFile': 'Edit',
            'files.interactivePreview': 'Interactive',
            'files.failedToDelete': 'Failed to delete file',
            'files.failedToRead': 'Failed to read file',
            'files.commentOnLine': 'Comment on line ' + (params?.line ?? ''),
            'files.commentOnNode': 'Comment on node ' + (params?.node ?? ''),
            'files.commentOnHoveredLine': 'Comment on hovered line',
            'files.inlineComments': 'Inline comments',
            'files.commentPlaceholder': 'Write a comment',
            'files.pinComment': 'Pin comment',
            'files.sendComments': 'Send ' + (params?.count ?? '') + ' comments',
            'files.removeComment': 'Remove comment',
            'files.lineNumber': 'Line ' + (params?.line ?? ''),
            'files.canvasNode': 'Canvas node ' + (params?.node ?? ''),
            'files.pinnedComment': 'Pinned comment',
            'files.invalidCanvas': 'Invalid canvas',
            'files.openExistingFile': 'Open existing file',
            'files.openFileTab': 'Open ' + (params?.name ?? ''),
            'files.resizeWorkspace': 'Resize file workspace',
            'happyHerd.composer.addPhoto': 'Add photo',
            'happyHerd.composer.addPhotos': 'Add photos',
            'happyHerd.composer.send': 'Send',
            'happyHerd.composer.sendFailedBody': 'Could not send feedback.',
            'review.feedbackPrompt': 'Share file feedback',
            'navigation.collapseSidebar': 'Collapse navigation',
            'navigation.expandSidebar': 'Expand navigation',
            'uiCopy.preview': 'Preview',
            'uiCopy.previewOfValue': 'Preview',
            'uiCopy.saved': 'Saved',
            'uiCopy.saving': 'Saving',
            'uiCopy.source': 'Source',
            'uiCopy.unsaved': 'Unsaved',
            'zen.toggle': 'Toggle Zen mode',
            'settings.machines': 'Machines',
            'workspace.title': 'Workspace',
            'workspace.pathPlaceholder': 'Path',
            'workspace.localhostUrlPlaceholder': 'http://localhost:3000',
            'workspace.openLocalhost': 'Open localhost URL',
            'workspace.invalidLocalhostUrl': 'Invalid localhost URL',
            'workspace.liveLoadFailed': 'Could not load the live page',
            'workspace.liveCommentOnElement': 'Comment on ' + (params?.element ?? ''),
            'workspace.liveElement': 'Element ' + (params?.element ?? ''),
            'workspace.startElementComment': 'Start commenting',
            'workspace.stopElementComment': 'Stop commenting',
            'workspace.go': 'Go',
            'workspace.home': 'Home',
            'workspace.root': 'Root',
            'workspace.parent': 'Parent',
            'workspace.refresh': 'Refresh',
            'workspace.favorites': 'Favorites',
            'workspace.upload': 'Upload',
            'workspace.newFolder': 'New folder',
            'workspace.searchPlaceholder': 'Search files',
            'uiCopy.attachValueToNextMessage': 'Add ' + (params?.value1 ?? '') + ' to message',
            'uiCopy.removeValueFromMessageContext': 'Remove ' + (params?.value1 ?? '') + ' from message',
        }[key] ?? key);
    `,
};

const fixturePlugin: Plugin = {
    name: 'desktop-workspace-browser-fixture',
    setup(buildContext) {
        buildContext.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path === '@/components/markdown/MarkdownView' || (args.path === './markdown/MarkdownView' && args.importer.endsWith('/CanvasFileViewer.web.tsx'))) {
                return { path: resolve(appRoot, 'sources/components/markdown/MarkdownView.web.tsx') };
            }
            if (args.path === '@/components/CanvasFileViewer') {
                return { path: resolve(appRoot, 'sources/components/CanvasFileViewer.web.tsx') };
            }
            if (args.path === '@/components/InlineCommentReview') {
                return { path: resolve(appRoot, 'sources/components/InlineCommentReview.web.tsx') };
            }
            if (args.path === '@/components/LocalhostLiveView') {
                return { path: resolve(appRoot, 'sources/components/LocalhostLiveView.web.tsx') };
            }
            if (args.path === './apiSocket' && args.importer.endsWith('/sync/workspaceLive.ts')) {
                return { path: '@/sync/apiSocket', namespace: 'fixture-stub' };
            }
            if (args.path === '@/components/FileDocumentPreview') {
                return { path: resolve(appRoot, 'sources/components/FileDocumentPreview.web.tsx') };
            }
            if (args.importer.endsWith('/FilesSidebar.tsx')) {
                const relativeStub = ({
                    './SideChatPanel': '@/components/SideChatPanel',
                    './AnimatedOverlay': '@/components/AnimatedOverlay',
                    './MobileGlass': '@/components/MobileGlass',
                } as Record<string, string>)[args.path];
                if (relativeStub) return { path: relativeStub, namespace: 'fixture-stub' };
            }
            if (args.importer.endsWith('/ChatHeaderView.tsx')) {
                const relativeStub = ({
                    './BubblePressable': '@/components/BubblePressable',
                    './MobileGlass': '@/components/MobileGlass',
                    './navigation/MobileHeaderScrim': '@/components/navigation/MobileHeaderScrim',
                } as Record<string, string>)[args.path];
                if (relativeStub) return { path: relativeStub, namespace: 'fixture-stub' };
            }
            if (args.path === './SidebarView') return { path: '@/components/SidebarView', namespace: 'fixture-stub' };
            if (args.path === '@/components/MultiTextInput') {
                return { path: resolve(appRoot, 'sources/components/MultiTextInput.web.tsx') };
            }
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
            outdir: 'out',
            format: 'esm',
            splitting: true,
            platform: 'browser',
            jsx: 'automatic',
            alias: { 'react-native': 'react-native-web' },
            loader: { '.png': 'dataurl', '.ttf': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const files = new Map(bundle.outputFiles.map((file) => [`/${basename(file.path)}`, file]));
        const stylesheet = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
        server = createServer((request, response) => {
            const outputFile = files.get(new URL(request.url ?? '/', 'http://fixture').pathname);
            if (outputFile) {
                response.setHeader('content-type', outputFile.path.endsWith('.css') ? 'text/css' : 'text/javascript');
                response.end(outputFile.contents);
                return;
            }
            if (request.url === '/workspace-live-sw.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.setHeader('service-worker-allowed', '/');
                response.end(readFileSync(resolve(appRoot, 'public/workspace-live-sw.js')));
                return;
            }
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;min-height:100%;font-family:sans-serif}*{box-sizing:border-box}' + stylesheet + '</style><main id="root"></main><script type="module" src="/desktopWorkspace.browser.fixture.js"></script>');
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

    it('keeps the hidden navigation toggle clear of the real session header', async () => {
        const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const headerDemo = page.getByTestId('collapsed-navigation-header-demo');
        const drawer = headerDemo.getByTestId('navigation-drawer');
        const boundaryToggle = headerDemo.getByTestId('navigation-sidebar-toggle');
        const sessionPath = headerDemo.getByText('demo-project', { exact: true });

        const hiddenToggleClearance = async () => {
            const boundaryToggleBox = await boundaryToggle.boundingBox();
            const sessionPathBox = await sessionPath.boundingBox();
            if (!boundaryToggleBox || !sessionPathBox) throw new Error('hidden header controls have no layout');
            expect(boundaryToggleBox.x + boundaryToggleBox.width + 8).toBeLessThanOrEqual(sessionPathBox.x);
            return { boundaryToggleBox, sessionPathBox };
        };

        await expect(boundaryToggle.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
        await expect(boundaryToggle.locator('[data-icon="sidebar-collapse"]').count()).resolves.toBe(1);
        await expect(boundaryToggle.locator('[data-icon="sidebar-expand"]').count()).resolves.toBe(0);
        await expect(boundaryToggle.locator('[data-icon^="chevron-"]').count()).resolves.toBe(0);
        const expandedToggleBox = await boundaryToggle.boundingBox();
        if (!expandedToggleBox) throw new Error('expanded navigation toggle has no layout');
        expect(expandedToggleBox.width).toBe(28);
        expect(expandedToggleBox.height).toBe(34);
        await expect(boundaryToggle.evaluate((element) => getComputedStyle(element).borderRadius)).resolves.toBe('9px');
        const toggleEvidenceDirectory = process.env.HAPPYHERD_SIDEBAR_TOGGLE_EVIDENCE_DIR?.trim();
        if (toggleEvidenceDirectory) {
            await boundaryToggle.screenshot({
                path: resolve(toggleEvidenceDirectory, 'ticktick-6a9931b5-sidebar-expanded.png'),
            });
        }
        const zenToggle = headerDemo.getByLabel('Toggle Zen mode');
        await zenToggle.click();
        const zenDrawerBox = await drawer.boundingBox();
        if (!zenDrawerBox) throw new Error('Zen navigation drawer has no layout');
        expect(zenDrawerBox.width).toBe(0);
        await expect(boundaryToggle.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
        const zenGeometry = await hiddenToggleClearance();

        await page.mouse.click(zenGeometry.sessionPathBox.x + 1, zenGeometry.sessionPathBox.y + zenGeometry.sessionPathBox.height / 2);
        await expect(page.evaluate(() => (window as any).__SESSION_TITLE_PRESS_COUNT__ ?? 0)).resolves.toBe(1);

        await zenToggle.click();
        const expandedDrawerBox = await drawer.boundingBox();
        if (!expandedDrawerBox) throw new Error('expanded navigation drawer has no layout');
        expect(expandedDrawerBox.width).toBeGreaterThan(0);

        await boundaryToggle.click();
        await expect(boundaryToggle.getAttribute('aria-label')).resolves.toBe('Expand navigation');
        await expect(boundaryToggle.locator('[data-icon="sidebar-expand"]').count()).resolves.toBe(1);
        await expect(boundaryToggle.locator('[data-icon="sidebar-collapse"]').count()).resolves.toBe(0);
        const collapsedGeometry = await hiddenToggleClearance();

        const idleBackground = await boundaryToggle.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(idleBackground);
        await boundaryToggle.hover();
        const hoverBackground = await boundaryToggle.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(['transparent', 'rgba(0, 0, 0, 0)']).not.toContain(hoverBackground);

        const boundaryToggleCenter = {
            x: collapsedGeometry.boundaryToggleBox.x + collapsedGeometry.boundaryToggleBox.width / 2,
            y: collapsedGeometry.boundaryToggleBox.y + collapsedGeometry.boundaryToggleBox.height / 2,
        };
        await page.mouse.move(boundaryToggleCenter.x, boundaryToggleCenter.y);
        await page.mouse.down();
        const pressedBackground = await boundaryToggle.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(['transparent', 'rgba(0, 0, 0, 0)']).not.toContain(pressedBackground);
        await page.mouse.move(
            collapsedGeometry.boundaryToggleBox.x + collapsedGeometry.boundaryToggleBox.width + 80,
            boundaryToggleCenter.y,
        );
        await page.mouse.up();
        await expect(boundaryToggle.getAttribute('aria-label')).resolves.toBe('Expand navigation');

        await page.mouse.click(
            collapsedGeometry.sessionPathBox.x + 1,
            collapsedGeometry.sessionPathBox.y + collapsedGeometry.sessionPathBox.height / 2,
        );
        await expect(page.evaluate(() => (window as any).__SESSION_TITLE_PRESS_COUNT__ ?? 0)).resolves.toBe(2);

        await page.mouse.move(700, 200);
        if (toggleEvidenceDirectory) {
            await boundaryToggle.screenshot({
                path: resolve(toggleEvidenceDirectory, 'ticktick-6a9931b5-sidebar-collapsed.png'),
            });
        }
        const evidencePath = process.env.HAPPYHERD_COLLAPSED_NAV_EVIDENCE_PATH?.trim();
        if (evidencePath) await headerDemo.screenshot({ path: resolve(evidencePath) });

        await boundaryToggle.click();
        await expect(boundaryToggle.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
        await expect(boundaryToggle.locator('[data-icon="sidebar-collapse"]').count()).resolves.toBe(1);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('shows one localized Back control and consumes overlays before route history', async () => {
        const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const headerDemo = page.getByTestId('collapsed-navigation-header-demo');
        const zenToggle = headerDemo.getByLabel('Toggle Zen mode');
        const controls = zenToggle.locator('..');
        const back = controls.getByLabel('Back', { exact: true });

        await expect(controls.locator('[aria-label]').count()).resolves.toBe(2);
        await expect(back.textContent()).resolves.toBe('Back');
        await expect(controls.locator('[data-icon="chevron-back"], [data-icon="chevron-forward"]').count()).resolves.toBe(0);
        await expect(back.isEnabled()).resolves.toBe(true);
        await expect(back.getAttribute('aria-label')).resolves.toBe('Back');

        const zenBox = await zenToggle.boundingBox();
        const backBox = await back.boundingBox();
        if (!zenBox || !backBox) throw new Error('persistent header controls have no layout');
        expect(zenBox.width).toBe(28);
        expect(zenBox.height).toBe(28);
        expect(backBox.width).toBe(28);
        expect(backBox.height).toBe(28);
        expect(backBox.x - zenBox.x - zenBox.width).toBe(4);

        await back.click();
        await expect(page.evaluate(() => (window as any).__OVERLAY_BACK_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__ROUTE_BACK_MARK_COUNT__ ?? 0)).resolves.toBe(0);
        await expect(page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__ ?? 0)).resolves.toBe(0);

        await page.evaluate(() => { (window as any).__OVERLAY_BACK_ENABLED__ = false; });
        await back.click();
        await expect(page.evaluate(() => (window as any).__OVERLAY_BACK_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__ROUTE_BACK_MARK_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__ ?? 0)).resolves.toBe(1);

        const evidencePath = process.env.HAPPYHERD_SIDEBAR_BACK_EVIDENCE_PATH?.trim();
        if (evidencePath) await headerDemo.screenshot({ path: resolve(evidencePath) });
        expect(pageErrors).toEqual([]);
        await page.close();

        const disabledPage = await browser.newPage({ viewport: { width: 900, height: 300 } });
        await disabledPage.goto(origin + '?back-disabled=1');
        const disabledBack = disabledPage
            .getByTestId('collapsed-navigation-header-demo')
            .getByLabel('Back', { exact: true });
        await expect(disabledBack.isDisabled()).resolves.toBe(true);
        await expect(disabledBack.evaluate((element) => getComputedStyle(element).opacity)).resolves.toBe('0.3');
        await disabledPage.close();
    }, 10_000);

    it('uses the real boundary toggle and pointer divider without overlapping or remounting', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const sidebarDemo = page.getByTestId('sidebar-demo');
        const drawer = sidebarDemo.getByTestId('navigation-drawer');
        const collapse = sidebarDemo.getByTestId('navigation-sidebar-toggle');
        await collapse.waitFor();
        await expect(collapse.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
        await expect(collapse.locator('[data-icon="sidebar-collapse"]').count()).resolves.toBe(1);
        const sidebarBox = await sidebarDemo.boundingBox();
        const drawerBox = await drawer.boundingBox();
        const collapseBox = await collapse.boundingBox();
        if (!sidebarBox || !drawerBox || !collapseBox) throw new Error('sidebar fixture has no layout');
        expect(Math.abs(collapseBox.x + collapseBox.width / 2 - drawerBox.x - drawerBox.width)).toBeLessThan(2);
        expect(Math.abs(collapseBox.y - sidebarBox.y - 15)).toBeLessThan(2);

        const splitDemo = page.getByTestId('split-demo');
        const host = splitDemo.getByTestId('desktop-file-workspace-host');
        const divider = splitDemo.getByTestId('desktop-file-workspace-divider');
        const input = splitDemo.getByTestId('main-agent-composer-draft');
        const chat = splitDemo.getByTestId('main-agent-chat');
        const chatScroll = splitDemo.getByTestId('main-agent-chat-scroll');
        const editorPanel = splitDemo.getByTestId('desktop-file-panel:/workspace/demo.md');
        await splitDemo.getByRole('button', { name: 'Edit' }).click();
        const editor = editorPanel.getByTestId('code-editor');
        const unsavedValue = '# Unsaved editor state\n'.repeat(40);
        await editor.fill(unsavedValue);
        await editor.evaluate((element) => { element.scrollTop = 120; });
        const initialEditorScrollTop = await editor.evaluate((element) => element.scrollTop);
        const editorMountId = `editor-${Date.now()}`;
        await editor.evaluate((element, mountId) => {
            element.setAttribute('data-retention-mount-id', mountId);
        }, editorMountId);
        expect(initialEditorScrollTop).toBeGreaterThan(0);

        await input.fill('human draft survives');
        await chatScroll.evaluate((element) => { element.scrollTop = 120; });
        const initialChatScrollTop = await chatScroll.evaluate((element) => element.scrollTop);
        expect(initialChatScrollTop).toBeGreaterThan(0);
        const initialSplitBox = await splitDemo.boundingBox();
        const initialHostBox = await host.boundingBox();
        const initialDividerBox = await divider.boundingBox();
        const initialMountId = await chat.getAttribute('data-mount-id');
        if (!initialSplitBox || !initialHostBox || !initialDividerBox || !initialMountId) {
            throw new Error('split fixture has no layout');
        }

        await page.mouse.move(
            initialDividerBox.x + initialDividerBox.width / 2,
            initialDividerBox.y + initialDividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(initialDividerBox.x - 2_000, initialDividerBox.y + initialDividerBox.height / 2, { steps: 12 });
        await page.mouse.up();

        const resizedHostBox = await host.boundingBox();
        const resizedSplitBox = await splitDemo.boundingBox();
        const resizedDividerBox = await divider.boundingBox();
        if (!resizedHostBox || !resizedSplitBox || !resizedDividerBox) {
            throw new Error('resized split has no layout');
        }
        const resizedPaneWidth = resizedSplitBox.width - resizedDividerBox.width;
        const resizedChatWidth = resizedPaneWidth - resizedHostBox.width;
        expect(resizedHostBox.width / resizedPaneWidth).toBeCloseTo(0.75, 2);
        expect(resizedChatWidth / resizedPaneWidth).toBeCloseTo(0.25, 2);
        expect(resizedHostBox.width).toBeGreaterThan(initialHostBox.width + 100);
        await expect(chat.getAttribute('data-mount-id')).resolves.toBe(initialMountId);
        await expect(input.inputValue()).resolves.toBe('human draft survives');
        await expect(chatScroll.evaluate((element) => element.scrollTop)).resolves.toBe(initialChatScrollTop);
        await expect(editor.getAttribute('data-retention-mount-id')).resolves.toBe(editorMountId);
        await expect(editor.inputValue()).resolves.toBe(unsavedValue);
        await expect(editor.evaluate((element) => element.scrollTop)).resolves.toBe(initialEditorScrollTop);

        await collapse.click();
        const expand = sidebarDemo.getByTestId('navigation-sidebar-toggle');
        await expand.waitFor();
        await expect(expand.getAttribute('aria-label')).resolves.toBe('Expand navigation');
        await expect(expand.locator('[data-icon="sidebar-expand"]').count()).resolves.toBe(1);
        const expandBox = await expand.boundingBox();
        const zenBox = await sidebarDemo.getByLabel('Toggle Zen mode').boundingBox();
        if (!expandBox || !zenBox) throw new Error('collapsed controls have no layout');
        expect(expandBox.x + expandBox.width).toBeLessThanOrEqual(zenBox.x);
        const collapsedSplitBox = await splitDemo.boundingBox();
        if (!collapsedSplitBox) throw new Error('collapsed split has no layout');
        expect(collapsedSplitBox.width).toBeGreaterThan(initialSplitBox.width + 300);
        await expect(editor.getAttribute('data-retention-mount-id')).resolves.toBe(editorMountId);
        await expect(editor.inputValue()).resolves.toBe(unsavedValue);
        await expect(editor.evaluate((element) => element.scrollTop)).resolves.toBe(initialEditorScrollTop);
        await expect(chat.getAttribute('data-mount-id')).resolves.toBe(initialMountId);
        await expect(input.inputValue()).resolves.toBe('human draft survives');
        await expect(chatScroll.evaluate((element) => element.scrollTop)).resolves.toBe(initialChatScrollTop);

        await expand.click();
        await expect(collapse.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
        await expect(collapse.locator('[data-icon="sidebar-collapse"]').count()).resolves.toBe(1);
        const reopenedSplitBox = await splitDemo.boundingBox();
        if (!reopenedSplitBox) throw new Error('reopened split has no layout');
        expect(Math.abs(reopenedSplitBox.width - initialSplitBox.width)).toBeLessThan(2);
        await expect(editor.getAttribute('data-retention-mount-id')).resolves.toBe(editorMountId);
        await expect(editor.inputValue()).resolves.toBe(unsavedValue);
        await expect(editor.evaluate((element) => element.scrollTop)).resolves.toBe(initialEditorScrollTop);
        await expect(splitDemo.getByTestId('main-agent-chat').isVisible()).resolves.toBe(true);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it('keeps wide controls focused and narrow controls complete in the real file workspace', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const wide = page.getByTestId('wide-file-workspace');
        await wide.getByRole('button', { name: 'Preview' }).waitFor();
        await expect(wide.getByRole('button', { name: 'Source' }).count()).resolves.toBe(0);
        await expect(wide.getByRole('button', { name: 'Edit' }).count()).resolves.toBe(1);
        await expect(wide.getByRole('button', { name: 'Delete' }).count()).resolves.toBe(1);
        await expect(wide.locator('.hh-markdown-root').isVisible()).resolves.toBe(true);

        await wide.getByRole('button', { name: 'Edit' }).click();
        await expect(wide.getByTestId('code-editor').getAttribute('data-read-only')).resolves.toBe('false');
        await wide.getByRole('button', { name: 'Preview' }).click();
        await expect(wide.locator('.hh-markdown-root').isVisible()).resolves.toBe(true);
        await wide.getByRole('button', { name: 'Delete' }).click();
        await expect(page.evaluate(() => (window as any).__DELETE_RPC_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FILE_DELETED_COUNT__ ?? 0)).resolves.toBe(1);

        const narrow = page.getByTestId('narrow-file-workspace');
        await narrow.getByTestId('desktop-file-workspace-fullscreen-header').waitFor();
        await expect(narrow.getByTestId('desktop-file-workspace-divider').count()).resolves.toBe(0);
        await expect(narrow.getByRole('tab').count()).resolves.toBe(0);
        await narrow.getByRole('button', { name: 'Preview' }).waitFor();
        await expect(narrow.getByRole('button', { name: 'Source' }).count()).resolves.toBe(0);
        await expect(narrow.getByRole('button', { name: 'Edit' }).count()).resolves.toBe(1);
        await expect(narrow.getByRole('button', { name: 'Delete' }).count()).resolves.toBe(0);
        await narrow.getByRole('button', { name: 'Edit' }).click();
        await expect(narrow.getByTestId('code-editor').getAttribute('data-read-only')).resolves.toBe('false');
        await narrow.getByRole('button', { name: 'Preview' }).click();
        await expect(narrow.locator('.hh-markdown-root').isVisible()).resolves.toBe(true);

        const evidenceDirectory = process.env.HAPPYHERD_ISSUE_181_EVIDENCE_DIR;
        if (evidenceDirectory) {
            await sidebarDemoScreenshot(page, evidenceDirectory);
            await page.getByTestId('split-demo').screenshot({ path: resolve(evidenceDirectory, 'issue-181-wide.png') });
            await narrow.screenshot({ path: resolve(evidenceDirectory, 'issue-181-mobile.png') });
        }
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    async function expectMobileCommentTypography(scope: Locator) {
        const sizes = await scope.locator('textarea, [dir="auto"]').evaluateAll((elements) => (
            elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
        ));
        expect(sizes.length).toBeGreaterThan(0);
        expect(sizes.every((size) => size >= 16)).toBe(true);
    }

    async function expectReviewBarDocked(panel: Locator) {
        const bar = panel.getByTestId('inline-comment-review-bar');
        await bar.waitFor();
        const [panelBox, barBox] = await Promise.all([panel.boundingBox(), bar.boundingBox()]);
        if (!panelBox || !barBox) throw new Error('Review bar has no browser layout box');
        expect(Math.abs((barBox.y + barBox.height) - (panelBox.y + panelBox.height))).toBeLessThan(2);
    }

    async function reviewGutterGeometry(number: Locator, button: Locator, content: Locator) {
        const [numberBox, buttonBox, contentBox, colors] = await Promise.all([
            number.boundingBox(), button.boundingBox(), content.boundingBox(),
            button.evaluate((element) => {
                const style = getComputedStyle(element);
                return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
            }),
        ]);
        if (!numberBox || !buttonBox || !contentBox) throw new Error('Review gutter has no browser layout');
        return {
            ...colors,
            numberWidth: numberBox.width,
            buttonWidth: buttonBox.width,
            buttonHeight: buttonBox.height,
            numberGap: buttonBox.x - (numberBox.x + numberBox.width),
            contentGap: contentBox.x - (buttonBox.x + buttonBox.width),
        };
    }

    async function verifyMarkdownReviewJourney(
        page: Page,
        surfaceId: string,
        feedbackIndex = 0,
        touch = false,
        expectedTheme: 'light' | 'dark' = 'light',
    ) {
        const workspace = page.getByTestId(surfaceId);
        const markdownPanel = workspace.getByTestId('desktop-file-panel:/workspace/demo.md');
        const markdownRoot = markdownPanel.locator('.hh-markdown-root');
        await markdownRoot.waitFor();
        const markdownClass = await markdownRoot.getAttribute('class');
        if (expectedTheme === 'dark') expect(markdownClass).toContain('hh-markdown-dark');
        else expect(markdownClass).not.toContain('hh-markdown-dark');

        const heading = markdownRoot.locator('h1[data-source-line="1"]');
        const headingLineNumber = heading.locator('.hh-markdown-source-line');
        const headingGutter = heading.locator('.hh-markdown-comment-gutter');
        if (touch) {
            await expect.poll(() => headingGutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        } else {
            await expect(headingGutter.evaluate((element) => getComputedStyle(element).opacity)).resolves.toBe('0');
            await heading.hover();
            await expect.poll(() => headingGutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        }
        await expect(headingLineNumber.textContent()).resolves.toBe('1');
        const affordance = await heading.evaluate((element) => {
            const lineNumber = element.querySelector('.hh-markdown-source-line')!;
            const button = element.querySelector('.hh-markdown-comment-gutter')!;
            const lineRect = lineNumber.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            const contentRect = element.getBoundingClientRect();
            const style = getComputedStyle(button);
            const clippingAncestors: Array<{ left: number; right: number }> = [];
            for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
                const ancestorStyle = getComputedStyle(ancestor);
                if (['auto', 'clip', 'hidden', 'scroll'].includes(ancestorStyle.overflowX)) {
                    const ancestorRect = ancestor.getBoundingClientRect();
                    clippingAncestors.push({ left: ancestorRect.left, right: ancestorRect.right });
                }
            }
            return {
                width: buttonRect.width,
                height: buttonRect.height,
                backgroundColor: style.backgroundColor,
                borderTopWidth: style.borderTopWidth,
                sourceOrder: lineRect.right <= buttonRect.left && buttonRect.right <= contentRect.left,
                fullyVisible: clippingAncestors.every((ancestor) => (
                    buttonRect.left >= ancestor.left - 0.5 && buttonRect.right <= ancestor.right + 0.5
                )),
            };
        });
        expect(affordance.fullyVisible).toBe(true);
        expect(affordance.width).toBe(20);
        expect(affordance.height).toBe(20);
        expect(affordance.sourceOrder).toBe(true);
        expect(affordance.backgroundColor).toBe(expectedTheme === 'dark' ? 'rgb(210, 153, 34)' : 'rgb(154, 103, 0)');
        expect(affordance.borderTopWidth).toBe('0px');
        const geometry = await reviewGutterGeometry(headingLineNumber, headingGutter, heading);
        expect(geometry.numberGap).toBe(4);
        expect(geometry.contentGap).toBe(8);

        const sessionRelativeLink = markdownPanel.getByRole('link', { name: 'Open session relative' });
        if (touch) await sessionRelativeLink.tap();
        else await sessionRelativeLink.click();
        const workspaceRoutes = await page.evaluate(() => (window as any).__WORKSPACE_LINK_CALLS__ ?? []);
        expect(workspaceRoutes.at(-1)).toMatchObject({
            params: {
                originSessionId: 'ordinary-session',
                machineId: 'machine-1',
                absolutePath: '/workspace/notes/session-child.md',
            },
        });

        const fence = markdownPanel.locator('.hh-markdown-review-line[data-source-line="6"]');
        await fence.scrollIntoViewIfNeeded();
        if (!touch) await fence.hover();
        const fenceGutter = fence.locator(':scope > .hh-markdown-review-gutter .hh-markdown-comment-gutter');
        await expect(fenceGutter.evaluate((button) => {
            const box = button.getBoundingClientRect();
            const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return target === button || button.contains(target);
        })).resolves.toBe(true);
        if (touch) await fenceGutter.tap();
        else await fenceGutter.click();
        const fenceComposer = markdownPanel.getByTestId('inline-comment-composer:line:6');
        await fenceComposer.waitFor();
        await fenceComposer.getByRole('button', { name: 'Cancel' }).click();

        for (const [line, feedback] of [[3, 'First line note'], [4, 'Second line note']] as const) {
            const item = markdownPanel.locator(`li[data-source-line="${line}"]`);
            await item.evaluate((element) => element.scrollIntoView({ block: 'center' }));
            const gutter = item.locator('.hh-markdown-comment-gutter');
            if (touch) {
                await expect.poll(() => gutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
                await gutter.tap();
            } else {
                await item.hover();
                await gutter.click();
            }
            const composer = item.getByTestId(`inline-comment-composer:line:${line}`);
            await composer.waitFor();
            await composer.getByPlaceholder('Write a comment').fill(feedback);
            if (touch) await expectMobileCommentTypography(composer);
            await composer.getByRole('button', { name: 'Pin comment' }).click();
            const thread = item.getByTestId(`inline-comment-thread:line:${line}`);
            await expect(thread.getByText(feedback, { exact: true }).count()).resolves.toBe(1);
            await expect(thread.getByTestId(`inline-comment-seam:line:${line}`).count()).resolves.toBe(1);
            const cardBackground = await thread.locator(':scope > div').nth(1).evaluate((element) => getComputedStyle(element).backgroundColor);
            expect(cardBackground).toBe(expectedTheme === 'dark' ? 'rgb(33, 30, 24)' : 'rgb(255, 250, 240)');
        }

        const firstThread = markdownPanel.getByTestId('inline-comment-thread:line:3');
        const secondThread = markdownPanel.getByTestId('inline-comment-thread:line:4');
        await expect(firstThread.getByText('Second line note', { exact: true }).count()).resolves.toBe(0);
        await expect(secondThread.getByText('First line note', { exact: true }).count()).resolves.toBe(0);
        await firstThread.getByRole('button', { name: 'Edit' }).click();
        await firstThread.getByRole('textbox', { name: 'Write a comment' }).fill('First line note edited');
        await firstThread.getByRole('button', { name: 'Save' }).click();
        await expect(firstThread.getByText('First line note edited', { exact: true }).count()).resolves.toBe(1);
        await secondThread.getByRole('button', { name: 'Remove comment' }).click();
        await expect(markdownPanel.getByRole('button', { name: 'Send 1 comments' }).count()).resolves.toBe(1);

        const secondItem = markdownPanel.locator('li[data-source-line="4"]');
        if (touch) await secondItem.locator('.hh-markdown-comment-gutter').tap();
        else {
            await secondItem.hover();
            await secondItem.locator('.hh-markdown-comment-gutter').click();
        }
        const replacementComposer = secondItem.getByTestId('inline-comment-composer:line:4');
        await replacementComposer.getByPlaceholder('Write a comment').fill('Second line note replacement');
        await replacementComposer.getByRole('button', { name: 'Pin comment' }).click();
        await expectReviewBarDocked(markdownPanel);
        if (touch) await expectMobileCommentTypography(markdownPanel.getByTestId('inline-comment-review-bar'));
        const evidenceDirectory = process.env.HAPPYHERD_MARKDOWN_COMMENT_EVIDENCE_DIR?.trim();
        if (evidenceDirectory) {
            await markdownPanel.screenshot({
                path: resolve(
                    evidenceDirectory,
                    `task-6a9aa121-seam-markdown-${touch ? 'mobile' : 'desktop'}-${expectedTheme}.png`,
                ),
            });
        }
        await markdownPanel.getByRole('button', { name: 'Send 2 comments' }).click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(feedbackIndex + 1);
        const markdownFeedback = await page.evaluate((index) => (window as any).__WORKSPACE_FEEDBACK_CALLS__[index].text, feedbackIndex);
        expect(markdownFeedback).toContain('Line: 3');
        expect(markdownFeedback).toContain('First line note edited');
        expect(markdownFeedback).toContain('Line: 4');
        expect(markdownFeedback).toContain('Second line note replacement');
        return geometry;
    }

    async function verifyMachineMarkdownLinkJourney(page: Page, surfaceId: string) {
        const workspace = page.getByTestId(surfaceId);
        await workspace.getByRole('tab', { name: 'Open machine.md' }).click();
        const machinePanel = workspace.getByTestId('desktop-file-panel:/machine-root/machine.md');
        await machinePanel.locator('.hh-markdown-root').waitFor();
        await machinePanel.getByRole('link', { name: 'Open machine relative' }).click();
        const workspaceRoutes = await page.evaluate(() => (window as any).__WORKSPACE_LINK_CALLS__ ?? []);
        expect(workspaceRoutes.at(-1)).toMatchObject({
            params: {
                originSessionId: 'ordinary-session',
                machineId: 'machine-2',
                absolutePath: '/machine-root/notes/machine-child.md',
            },
        });
    }

    async function activateSourceLine(page: Page, sourcePanel: Locator, line: number, touch: boolean) {
        const codeScroller = sourcePanel.locator('[data-code]');
        const sourceLine = sourcePanel.locator(`[data-line="${line}"]`);
        await sourceLine.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        await codeScroller.evaluate((element) => { element.scrollLeft = 0; });
        const [lineBox, scrollerBox] = await Promise.all([sourceLine.boundingBox(), codeScroller.boundingBox()]);
        if (!lineBox || !scrollerBox) throw new Error(`Source line ${line} has no browser layout box`);
        if (touch) {
            await page.touchscreen.tap(lineBox.x + Math.min(10, lineBox.width / 2), lineBox.y + (lineBox.height / 2));
        } else {
            await sourceLine.hover({ position: { x: 10, y: lineBox.height / 2 } });
            await expect(sourcePanel.getByRole('button', { name: 'Comment on hovered line' }).isVisible()).resolves.toBe(true);
            await sourcePanel.getByRole('button', { name: 'Comment on hovered line' }).click();
        }
        await sourcePanel.getByTestId(`inline-comment-composer:line:${line}`).waitFor();
        await expect(sourcePanel.getByText(`Comment on line ${line}`, { exact: true }).count()).resolves.toBe(1);
        await expect(sourcePanel.locator('[data-selected-line]').count()).resolves.toBe(0);
    }

    it.each([
        { surface: 'desktop', themeName: 'light', width: 1440, height: 900, touch: false },
        { surface: 'desktop', themeName: 'dark', width: 1440, height: 900, touch: false },
        { surface: 'mobile', themeName: 'light', width: 390, height: 844, touch: true },
        { surface: 'mobile', themeName: 'dark', width: 390, height: 844, touch: true },
    ])('reveals cold source links without pinning hover or resetting the open draft ($surface, $themeName)', async ({ surface, themeName, width, height, touch }) => {
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
        const page = await context.newPage();
        const errors = recordPageErrors(page);
        let openingSource = false;
        let pendingChunks = 0;
        let releaseChunks!: () => void;
        const chunksReady = new Promise<void>((resolveReady) => { releaseChunks = resolveReady; });
        await page.route('**/*.js', async (route) => {
            if (openingSource) {
                pendingChunks += 1;
                await chunksReady;
            }
            await route.continue();
        });
        await page.goto(`${origin}?review-navigation=${surface}&theme=${themeName}`);
        await page.getByRole('link', { name: 'Open line 160' }).waitFor();
        openingSource = true;
        await page.getByRole('link', { name: 'Open line 160' }).click();
        const panel = page.getByTestId('desktop-file-panel:/workspace/navigation.ts');
        await panel.waitFor();
        await expect.poll(() => pendingChunks).toBeGreaterThan(0);
        // The actual lazy Pierre module is held back until the parent load
        // effect has run; a pre-render estimated scroll cannot pass this case.
        await expect(panel.locator('diffs-container').count()).resolves.toBe(0);
        releaseChunks();
        await panel.locator('[data-line="160"]').waitFor();

        const viewportState = () => panel.locator('diffs-container').evaluate((host) => {
            const row = host.shadowRoot!.querySelector('[data-line][data-review-highlight], [data-line][data-selected-line]')!;
            let scroller = host.parentElement!;
            while (scroller.parentElement && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
            const rowBox = row.getBoundingClientRect();
            const scrollBox = scroller.getBoundingClientRect();
            return {
                line: Number(row.getAttribute('data-line')),
                centerOffset: Math.abs((rowBox.top + rowBox.height / 2) - (scrollBox.top + scrollBox.height / 2)),
                scrollTop: scroller.scrollTop,
            };
        });
        await expect.poll(async () => (await viewportState()).line).toBe(160);
        await expect.poll(async () => (await viewportState()).centerOffset).toBeLessThan(3);
        await expect(panel.locator('[data-selected-line]').count()).resolves.toBe(0);

        await activateSourceLine(page, panel, 161, touch);
        const draft = panel.getByTestId('inline-comment-composer:line:161').getByPlaceholder('Write a comment');
        await draft.fill('Keep this draft on line 161');
        await activateSourceLine(page, panel, 161, touch);
        await expect(draft.inputValue()).resolves.toBe('Keep this draft on line 161');
        if (!touch) {
            await panel.locator('[data-line="163"]').hover();
            await expect.poll(() => panel.locator('[data-column-number="163"] [data-utility-button]').count()).toBe(1);
            await expect(draft.inputValue()).resolves.toBe('Keep this draft on line 161');
            await expect(panel.getByTestId('inline-comment-composer:line:163').count()).resolves.toBe(0);
        }

        await page.getByRole('link', { name: 'Open line 200' }).click();
        await expect.poll(async () => (await viewportState()).line).toBe(200);
        await expect.poll(async () => (await viewportState()).centerOffset).toBeLessThan(3);
        await expect(draft.inputValue()).resolves.toBe('Keep this draft on line 161');
        await expect(panel.locator('[data-selected-line]').count()).resolves.toBe(0);

        // Pinning a thread above the target changes its measured row position.
        // Navigating back must use the real DOM height and later hover must not
        // replay the navigation scroll.
        await panel.getByTestId('inline-comment-composer:line:161').getByRole('button', { name: 'Pin comment' }).click();
        await page.getByRole('link', { name: 'Open line 160' }).click();
        await page.getByRole('link', { name: 'Open line 200' }).click();
        await expect.poll(async () => (await viewportState()).centerOffset).toBeLessThan(3);
        await activateSourceLine(page, panel, 201, touch);
        const secondDraft = panel.getByTestId('inline-comment-composer:line:201').getByPlaceholder('Write a comment');
        const beforeTyping = await viewportState();
        await secondDraft.fill('Second independent line');
        if (!touch) await panel.locator('[data-line="202"]').hover();
        expect(Math.abs((await viewportState()).scrollTop - beforeTyping.scrollTop)).toBeLessThan(2);
        await expect(secondDraft.inputValue()).resolves.toBe('Second independent line');
        await expect(panel.getByTestId('inline-comment-thread:line:161').getByText('Keep this draft on line 161', { exact: true }).count()).resolves.toBe(1);
        await expect(panel.locator('[data-selected-line]').count()).resolves.toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 30_000);

    async function verifyMarkdownSourceReviewJourney(
        page: Page,
        surfaceId: string,
        touch = false,
        switchTab = true,
        expectedTheme: 'light' | 'dark' = 'light',
    ) {
        const workspace = page.getByTestId(surfaceId);
        if (switchTab) await workspace.getByRole('tab', { name: 'Open source.md' }).click();
        const sourcePanel = workspace.getByTestId('desktop-file-panel:/workspace/source.md');
        // A line-linked Markdown deep link stays rendered as a Preview; it never
        // falls back to the raw source renderer.
        await expect(sourcePanel.locator('diffs-container').count()).resolves.toBe(0);
        const heading = sourcePanel.locator('h1', { hasText: 'Source review' });
        await heading.waitFor();
        const markdownRoot = sourcePanel.locator('.hh-markdown-root');
        await expect(markdownRoot.count()).resolves.toBeGreaterThan(0);
        const markdownClass = await markdownRoot.getAttribute('class');
        if (expectedTheme === 'dark') expect(markdownClass).toContain('hh-markdown-dark');
        else expect(markdownClass).not.toContain('hh-markdown-dark');
        // The requested source line is revealed on the matching rendered unit.
        const revealed = sourcePanel.locator('h1[data-source-line="1"]');
        await detectedHeadingClass(page, revealed, 'hh-markdown-review-reveal');
        // The rendered review unit keeps its comment affordance.
        await expect(revealed.locator('.hh-markdown-comment-gutter').count()).resolves.toBeGreaterThan(0);
        await expect(page.evaluate(() => (window as any).__SESSION_WRITE_CALLS__ ?? [])).resolves.toEqual([]);
    }

    // Waits for a source-line element to carry a class, be it applied by the
    // reveal effect or already present after mount.
    async function detectedHeadingClass(page: Page, locator: Locator, className: string) {
        await expect.poll(async () => locator.evaluate((element) => element.className)).toContain(className);
    }

    async function verifyCodeReviewJourney(
        page: Page,
        surfaceId: string,
        feedbackIndex: number,
        switchTab = true,
        touch = false,
        expectedTheme: 'light' | 'dark' = 'light',
        expectedGutter?: Awaited<ReturnType<typeof reviewGutterGeometry>>,
    ) {
        const workspace = page.getByTestId(surfaceId);
        if (switchTab) await workspace.getByRole('tab', { name: 'Open review.ts' }).click();
        const sourcePanel = workspace.getByTestId('desktop-file-panel:/workspace/review.ts');
        await sourcePanel.locator('diffs-container').waitFor();

        const codeScroller = sourcePanel.locator('[data-code]');
        await expect.poll(() => codeScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        if (touch) await sourcePanel.locator('[data-column-number="1"]').tap();
        else await sourcePanel.locator('[data-line="1"]').hover();
        if (expectedGutter) {
            // Hovering a row as wide as the longest source line may scroll its
            // content horizontally. Compare the gutters at the content origin.
            await codeScroller.evaluate((element) => { element.scrollLeft = 0; });
            await expect.poll(async () => {
                if (touch) await sourcePanel.locator('[data-column-number="1"]').tap({ position: { x: 20, y: 10 } });
                return reviewGutterGeometry(
                    sourcePanel.locator('[data-column-number="1"] [data-line-number-content]'),
                    sourcePanel.locator('[data-utility-button]'),
                    sourcePanel.locator('[data-line="1"]'),
                );
            }).toEqual(expectedGutter);
        }
        if (!touch) {
            await sourcePanel.locator('[data-line="1"]').hover();
            const sourceAffordance = sourcePanel.getByRole('button', { name: 'Comment on hovered line' });
            await expect(sourceAffordance.isVisible()).resolves.toBe(true);
            await codeScroller.hover();
            await page.mouse.wheel(600, 0);
            await expect.poll(() => codeScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
            await expect(sourcePanel.getByPlaceholder('Write a comment').count()).resolves.toBe(0);
            await codeScroller.evaluate((element) => { element.scrollLeft = 0; });
        }

        for (const line of [1, 2, 3, 4] as const) {
            await activateSourceLine(page, sourcePanel, line, touch);

            const feedback = line === 2
                ? 'Blank line note'
                : line === 3 ? 'Long line note\nsecond line\nthird line\nfourth line\nfifth line' : null;
            if (feedback) {
                const thread = sourcePanel.getByTestId(`inline-comment-thread:line:${line}`);
                const composer = thread.getByTestId(`inline-comment-composer:line:${line}`);
                const textarea = composer.getByPlaceholder('Write a comment');
                const beforeThreadHeight = await thread.evaluate((element) => element.getBoundingClientRect().height);
                const followingLine = line === 3 ? sourcePanel.locator('[data-line="4"]') : null;
                const beforeFollowingY = followingLine
                    ? await followingLine.evaluate((element) => element.getBoundingClientRect().y)
                    : null;
                await textarea.fill(feedback);
                if (touch) await expectMobileCommentTypography(composer);
                if (line === 3 && followingLine && beforeFollowingY !== null) {
                    await expect.poll(() => thread.evaluate((element) => element.getBoundingClientRect().height))
                        .toBeGreaterThan(beforeThreadHeight + 50);
                    await expect.poll(() => followingLine.evaluate((element) => element.getBoundingClientRect().y))
                        .toBeGreaterThan(beforeFollowingY + 50);
                    await expect(thread.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).resolves.toBe(true);
                }
                await composer.getByRole('button', { name: 'Pin comment' }).click();
                await expect(thread.getByText(feedback, { exact: true }).count()).resolves.toBe(1);
                await expect(thread.getByTestId(`inline-comment-seam:line:${line}`).count()).resolves.toBe(1);
                const cardBackground = await thread.locator(':scope > div').nth(1).evaluate((element) => getComputedStyle(element).backgroundColor);
                expect(cardBackground).toBe(expectedTheme === 'dark' ? 'rgb(33, 30, 24)' : 'rgb(255, 250, 240)');
            } else {
                await sourcePanel.getByTestId(`inline-comment-composer:line:${line}`).getByRole('button', { name: 'Cancel' }).click();
            }
        }

        await expect(sourcePanel.getByTestId('inline-comment-thread:line:2').getByText('Blank line note', { exact: true }).count()).resolves.toBe(1);
        await expect(sourcePanel.getByTestId('inline-comment-thread:line:2').getByText('Long line note', { exact: false }).count()).resolves.toBe(0);
        await expect(sourcePanel.getByTestId('inline-comment-thread:line:3').getByText('Blank line note', { exact: true }).count()).resolves.toBe(0);
        const annotationGutters = sourcePanel.locator('[data-gutter] [data-gutter-buffer="annotation"]');
        await expect(annotationGutters.count()).resolves.toBeGreaterThanOrEqual(2);
        await expect(annotationGutters.first().evaluate((element) => getComputedStyle(element).boxShadow)).resolves.not.toBe('none');
        await expect(annotationGutters.first().evaluate((element) => getComputedStyle(element, '::after').content)).resolves.toBe('\"\"');
        await expect(annotationGutters.first().evaluate((element) => getComputedStyle(element, '::after').boxShadow)).resolves.not.toBe('none');
        await expectReviewBarDocked(sourcePanel);
        if (touch) {
            await expectMobileCommentTypography(sourcePanel.getByTestId('inline-comment-thread:line:2'));
            await expectMobileCommentTypography(sourcePanel.getByTestId('inline-comment-thread:line:3'));
            await expectMobileCommentTypography(sourcePanel.getByTestId('inline-comment-review-bar'));
        }
        const evidenceDirectory = process.env.HAPPYHERD_MARKDOWN_COMMENT_EVIDENCE_DIR?.trim();
        if (evidenceDirectory) {
            await sourcePanel.screenshot({
                path: resolve(
                    evidenceDirectory,
                    `task-6a9aa121-seam-code-${touch ? 'mobile' : 'desktop'}-${expectedTheme}.png`,
                ),
            });
        }
        await sourcePanel.getByRole('button', { name: 'Send 2 comments' }).click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(feedbackIndex + 1);
        const sourceFeedback = await page.evaluate((index) => (window as any).__WORKSPACE_FEEDBACK_CALLS__[index].text, feedbackIndex);
        expect(sourceFeedback).toContain('Line: 2');
        expect(sourceFeedback).toContain('Blank line note');
        expect(sourceFeedback).toContain('Line: 3');
        expect(sourceFeedback).toContain('Long line note\nsecond line\nthird line\nfourth line\nfifth line');

        if (touch) {
            const scrollerBox = await codeScroller.boundingBox();
            if (!scrollerBox) throw new Error('Source scroller has no browser layout box');
            const session = await page.context().newCDPSession(page);
            const y = scrollerBox.y + (scrollerBox.height / 2);
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x: scrollerBox.x + scrollerBox.width - 24, y }],
            });
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: scrollerBox.x + 48, y }],
            });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await session.detach();
            await expect.poll(() => codeScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
            await expect(sourcePanel.getByPlaceholder('Write a comment').count()).resolves.toBe(0);
        }
        await expect(page.evaluate(() => (window as any).__SESSION_WRITE_CALLS__ ?? [])).resolves.toEqual([]);
    }

    async function verifyCanvasReviewJourney(page: Page, surfaceId: string, switchTab: boolean, feedbackIndex: number, touch = false) {
        const workspace = page.getByTestId(surfaceId);
        if (switchTab) await workspace.getByRole('tab', { name: 'Open review.canvas' }).click();
        const canvasPanel = workspace.getByTestId('desktop-file-panel:/workspace/review.canvas');
        await canvasPanel.locator('.react-flow').waitFor();
        await expect(canvasPanel.locator('.react-flow__edge').count()).resolves.toBe(1);
        const canvasFileLink = canvasPanel.getByRole('button', { name: 'notes/My (draft) [v2].md' });
        if (touch) await canvasFileLink.tap();
        else await canvasFileLink.click();
        const workspaceRoutes = await page.evaluate(() => (window as any).__WORKSPACE_LINK_CALLS__ ?? []);
        expect(workspaceRoutes.at(-1).params.absolutePath).toBe('/workspace/notes/My (draft) [v2].md');

        for (const [node, feedback] of [['text-node', 'Start node note'], ['file-node', 'File node note']] as const) {
            const card = canvasPanel.locator(`.hh-canvas-${node === 'text-node' ? 'text' : 'file'}`);
            await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
            const commentButton = canvasPanel.getByRole('button', { name: `Comment on node ${node}` });
            if (touch) {
                await expect.poll(() => commentButton.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
                await commentButton.tap();
            } else {
                await card.hover();
                await commentButton.click();
            }
            const dockedThread = canvasPanel.getByTestId('inline-comment-thread:docked');
            await dockedThread.waitFor();
            await expect(canvasPanel.locator('[data-testid^="inline-comment-thread:line:"]').count()).resolves.toBe(0);
            await dockedThread.getByPlaceholder('Write a comment').fill(feedback);
            await dockedThread.getByRole('button', { name: 'Pin comment' }).click();
        }
        await expectReviewBarDocked(canvasPanel);
        await canvasPanel.getByRole('button', { name: 'Send 2 comments' }).click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(feedbackIndex + 1);
        const canvasFeedback = await page.evaluate((index) => (window as any).__WORKSPACE_FEEDBACK_CALLS__[index].text, feedbackIndex);
        expect(canvasFeedback).toContain('Canvas node ID: "text-node"');
        expect(canvasFeedback).toContain('Canvas node ID: "file-node"');

        if (touch) await canvasPanel.locator('.hh-canvas-text').tap({ position: { x: 30, y: 70 } });
        else await canvasPanel.locator('.hh-canvas-text').click({ position: { x: 30, y: 70 } });
        await expect(canvasPanel.locator('.hh-canvas-text').getAttribute('class')).resolves.toContain('selected');

        const flow = canvasPanel.locator('.react-flow');
        const viewport = canvasPanel.locator('.react-flow__viewport');
        const initialTransform = await viewport.getAttribute('style');
        const flowBox = await flow.boundingBox();
        if (!flowBox) throw new Error('Canvas flow has no browser layout box');
        await flow.hover({ position: { x: Math.max(10, flowBox.width - 80), y: Math.max(10, flowBox.height - 80) } });
        await page.mouse.wheel(0, -400);
        await expect.poll(() => viewport.getAttribute('style')).not.toBe(initialTransform);
        const zoomedTransform = await viewport.getAttribute('style');
        const pane = canvasPanel.locator('.react-flow__pane');
        const paneBox = await pane.boundingBox();
        if (!paneBox) throw new Error('Canvas pane has no browser layout box');
        await page.mouse.move(paneBox.x + paneBox.width - 60, paneBox.y + paneBox.height - 60);
        await page.mouse.down();
        await page.mouse.move(paneBox.x + paneBox.width - 120, paneBox.y + paneBox.height - 100, { steps: 4 });
        await page.mouse.up();
        await expect.poll(() => viewport.getAttribute('style')).not.toBe(zoomedTransform);
    }

    it.each(['light', 'dark'] as const)('pins and sends line-local file feedback in the production Web Desktop host (%s)', async (themeName) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}?file-review=desktop&theme=${themeName}`);
        const gutter = await verifyMarkdownReviewJourney(page, 'file-review-desktop', 0, false, themeName);
        await verifyMachineMarkdownLinkJourney(page, 'file-review-desktop');
        await verifyCodeReviewJourney(page, 'file-review-desktop', 1, true, false, themeName, gutter);
        await verifyCanvasReviewJourney(page, 'file-review-desktop', true, 2);
        await page.goto(`${origin}?file-review=desktop-markdown-source&theme=${themeName}`);
        await verifyMarkdownSourceReviewJourney(page, 'file-review-desktop', false, false, themeName);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 60_000);

    it.each(['light', 'dark'] as const)('pins and sends line-local file feedback in the production 390x844 Web Mobile host (%s)', async (themeName) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}?file-review=mobile&theme=${themeName}`);
        const gutter = await verifyMarkdownReviewJourney(page, 'file-review-mobile', 0, true, themeName);
        await page.goto(`${origin}?file-review=mobile-canvas&theme=${themeName}`);
        await verifyCanvasReviewJourney(page, 'file-review-mobile', false, 0, true);
        await page.goto(`${origin}?file-review=mobile-source&theme=${themeName}`);
        await verifyCodeReviewJourney(page, 'file-review-mobile', 0, false, true, themeName, gutter);
        await page.goto(`${origin}?file-review=mobile-markdown-source&theme=${themeName}`);
        await verifyMarkdownSourceReviewJourney(page, 'file-review-mobile', true, false, themeName);
        expect(pageErrors).toEqual([]);
        await page.close();
        await context.close();
    }, 60_000);

    it('retains every pinned Markdown thread after a failed batch send and clears them only after retry', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}?file-review=desktop&theme=dark&feedback-fail-once=1`);
        const panel = page.getByTestId('file-review-desktop').getByTestId('desktop-file-panel:/workspace/demo.md');
        await panel.locator('.hh-markdown-root').waitFor();

        for (const [line, feedback] of [[3, 'Retain first pin'], [4, 'Retain second pin']] as const) {
            const item = panel.locator(`li[data-source-line="${line}"]`);
            await item.hover();
            await item.locator('.hh-markdown-comment-gutter').click();
            const composer = item.getByTestId(`inline-comment-composer:line:${line}`);
            await composer.getByPlaceholder('Write a comment').fill(feedback);
            await composer.getByRole('button', { name: 'Pin comment' }).click();
        }

        await panel.getByRole('button', { name: 'Send 2 comments' }).click();
        await panel.getByRole('alert').waitFor();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_FAILURE_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(1);
        await expect(panel.getByTestId('inline-comment-thread:line:3').getByText('Retain first pin', { exact: true }).count()).resolves.toBe(1);
        await expect(panel.getByTestId('inline-comment-thread:line:4').getByText('Retain second pin', { exact: true }).count()).resolves.toBe(1);
        await expect(panel.getByRole('button', { name: 'Send 2 comments' }).count()).resolves.toBe(1);

        await panel.getByRole('button', { name: 'Send 2 comments' }).click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(2);
        await expect(panel.getByTestId('inline-comment-review-bar').count()).resolves.toBe(0);
        await expect(panel.locator('[data-testid^="inline-comment-thread:line:"]').count()).resolves.toBe(0);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        { mode: 'desktop', width: 1440, height: 900, sessionId: 'main-agent-desktop' },
        { mode: 'mobile', width: 390, height: 844, sessionId: 'side-chat-mobile' },
    ])('opens selected-machine localhost live and sends one Orca-style element comment on $mode', async ({ mode, width, height, sessionId }) => {
        const page = await browser.newPage({ viewport: { width, height } });
        const pageErrors = recordPageErrors(page);
        const browserLocalRequests: string[] = [];
        page.on('request', (request) => {
            if (/^http:\/\/localhost:3000(?:\/|$)|^http:\/\/127\.0\.0\.1:4000(?:\/|$)/.test(request.url())) {
                browserLocalRequests.push(request.url());
            }
        });
        await page.goto(`${origin}?localhost-live=${mode}`);

        const workspace = page.getByTestId(mode === 'mobile' ? 'localhost-live-mobile' : 'localhost-live-desktop');
        await workspace.getByRole('textbox', { name: 'Open localhost URL' }).fill('http://localhost:3000/live');
        await workspace.getByRole('button', { name: 'Open localhost URL' }).click();

        const frame = workspace.frameLocator('iframe');
        const liveTarget = frame.getByRole('button', { name: 'Live from machine-2' });
        await liveTarget.waitFor({ timeout: 15_000 });
        await expect(liveTarget.evaluate((element) => getComputedStyle(element).display)).resolves.toBe('flex');
        await expect(liveTarget.evaluate((element) => getComputedStyle(element).backgroundColor)).resolves.toBe('rgb(25, 90, 180)');

        const expectedRpcUrls = [
            'http://localhost:3000/live',
            'http://127.0.0.1:4000/redirected/live.css',
            'http://127.0.0.1:4000/redirected/live.js',
            'http://127.0.0.1:4000/redirected/api/state',
            'http://127.0.0.1:4000/redirected/css-bg.svg',
            'http://127.0.0.1:4000/redirected/inline.svg',
            'http://127.0.0.1:4000/redirected/unquoted.svg',
            'http://127.0.0.1:4000/redirected/srcset.svg',
            'http://127.0.0.1:4000/redirected/dynamic.svg',
            'http://127.0.0.1:4000/redirected/dynamic-style.svg',
        ];
        await expect.poll(async () => (
            await page.evaluate(() => (window as any).__WORKSPACE_LIVE_RPC_CALLS__ ?? [])
        ).map((call: any) => call.url)).toEqual(expect.arrayContaining(expectedRpcUrls));
        const rpcCalls = await page.evaluate(() => (window as any).__WORKSPACE_LIVE_RPC_CALLS__ ?? []);
        expect(rpcCalls.length).toBeGreaterThanOrEqual(4);
        expect(rpcCalls.every((call: any) => call.machineId === 'machine-2'
            && call.method === 'workspace-live-fetch')).toBe(true);
        expect(browserLocalRequests).toEqual([]);

        await workspace.getByRole('button', { name: 'Start commenting' }).click();
        await workspace.getByRole('button', { name: 'Stop commenting' }).waitFor();
        await page.waitForTimeout(150);
        await liveTarget.scrollIntoViewIfNeeded();
        await liveTarget.hover();
        await liveTarget.click();
        const comment = workspace.getByPlaceholder('Write a comment');
        try {
            await comment.waitFor({ timeout: 10_000 });
        } catch (error) {
            throw new Error(`Element picker did not produce a comment. Workspace: ${await workspace.innerText()}; errors: ${pageErrors.join(' | ')}`, { cause: error });
        }
        const dockedThread = workspace.getByTestId('inline-comment-thread:docked');
        await dockedThread.waitFor();
        await expect(workspace.locator('[data-testid^="inline-comment-thread:line:"]').count()).resolves.toBe(0);
        await comment.fill('Increase the button hit area');
        await dockedThread.getByRole('button', { name: 'Pin comment' }).click();
        await expectReviewBarDocked(workspace);
        await workspace.getByRole('button', { name: 'Send 1 comments' }).click();

        await expect.poll(() => page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? []))
            .toHaveLength(1);
        const feedback = await page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__[0]);
        expect(feedback.sessionId).toBe(sessionId);
        expect(feedback.text).toContain('Live URL: http://localhost:3000/live');
        expect(feedback.text).toContain('Element selector: "#live-target"');
        expect(feedback.text).toContain('Element HTML:');
        expect(feedback.text).toContain('Element CSS:');
        expect(feedback.text).toContain('Element bounds:');
        expect(feedback.options.attachments).toHaveLength(1);
        expect(feedback.options.attachments[0]).toMatchObject({ mimeType: 'image/png' });
        expect(feedback.options.attachments[0].width).toBeLessThan(width);
        expect(feedback.options.requireAllAttachments).toBe(true);
        const opaquePixels = await page.evaluate(async () => {
            const attachment = (window as any).__WORKSPACE_FEEDBACK_CALLS__[0].options.attachments[0];
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error('Could not decode captured element PNG'));
                image.src = attachment.uri;
            });
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Could not inspect captured element PNG');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let index = 3; index < pixels.length; index += 4) {
                if (pixels[index] > 0) count += 1;
            }
            return count;
        });
        expect(opaquePixels).toBeGreaterThan(0);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 60_000);

    it('opens task HTML in the single scriptless Preview with no separate Interactive control', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(origin + '?interactive-html=desktop');

        const workspace = page.getByTestId('interactive-html-workspace-wide');
        const frame = workspace.frameLocator('iframe');
        await frame.getByText('Scripts have not run', { exact: true }).waitFor();
        await expect(frame.getByTestId('task-card').count()).resolves.toBe(0);

        const pageErrors = recordPageErrors(page);
        // HTML exposes one Preview; the separate Interactive toggle is absent.
        await expect(workspace.getByRole('button', { name: 'Interactive', exact: true }).count()).resolves.toBe(0);
        await expect(workspace.getByRole('button', { name: 'Preview', exact: true }).count()).resolves.toBeGreaterThan(0);
        // Switching tabs and back keeps the scriptless Preview surface.
        await workspace.getByRole('tab', { name: 'Open notes.md' }).click();
        await workspace.getByRole('tab', { name: 'Open task.html' }).click();
        await frame.getByText('Scripts have not run', { exact: true }).waitFor();
        await expect(frame.getByTestId('task-card').count()).resolves.toBe(0);

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('keeps task HTML in the scriptless Preview at the Web Mobile viewport', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(origin + '?interactive-html=mobile');

        const workspace = page.getByTestId('interactive-html-workspace-mobile');
        const frame = workspace.frameLocator('iframe');
        await frame.getByText('Scripts have not run', { exact: true }).waitFor();
        await expect(frame.getByTestId('task-card').count()).resolves.toBe(0);

        const pageErrors = recordPageErrors(page);
        await expect(workspace.getByRole('button', { name: 'Interactive', exact: true }).count()).resolves.toBe(0);
        await page.setViewportSize({ width: 430, height: 844 });
        await frame.getByText('Scripts have not run', { exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(frame.getByTestId('task-card').count()).resolves.toBe(0);

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('keeps multiline feedback contained and sendable in the narrow adjustable workspace', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);

        const splitDemo = page.getByTestId('split-demo');
        const host = splitDemo.getByTestId('desktop-file-workspace-host');
        const divider = splitDemo.getByTestId('desktop-file-workspace-divider');
        const dividerBox = await divider.boundingBox();
        if (!dividerBox) throw new Error('workspace divider has no layout');
        await page.mouse.move(
            dividerBox.x + dividerBox.width / 2,
            dividerBox.y + dividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(dividerBox.x + 2_000, dividerBox.y + dividerBox.height / 2, { steps: 12 });
        await page.mouse.up();

        const hostBox = await host.boundingBox();
        if (!hostBox) throw new Error('narrow workspace host has no layout');
        expect(hostBox.width).toBeLessThanOrEqual(361);

        const feedback = host.getByPlaceholder('Share file feedback');
        const send = host.getByRole('button', { name: 'Send' });
        const multiline = [
            'test test test test test test test test test test test',
            'follow-up feedback remains inside the file workspace',
            'sdfsdfsdfddfdfdf',
        ].join('\n');
        await feedback.fill(multiline);

        const feedbackBox = await feedback.boundingBox();
        const sendBox = await send.boundingBox();
        if (!feedbackBox || !sendBox) throw new Error('workspace feedback controls have no layout');
        expect(feedbackBox.x + feedbackBox.width).toBeLessThanOrEqual(sendBox.x - 8);
        const feedbackMetrics = await feedback.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
        }));
        expect(feedbackMetrics.scrollWidth).toBeLessThanOrEqual(feedbackMetrics.clientWidth);
        expect(feedbackMetrics.clientHeight).toBeGreaterThan(44);

        await send.click();
        const feedbackCalls = await page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? []);
        expect(feedbackCalls).toHaveLength(1);
        expect(feedbackCalls[0]).toEqual({
            sessionId: 'ordinary-session',
            text: [
                'Workspace file feedback',
                '',
                'Machine: machine-1',
                'Machine ID: machine-1',
                'Absolute path: /workspace/demo.md',
                '',
                'Feedback:',
                multiline,
            ].join('\n'),
            options: {
                displayText: ['machine-1', '/workspace/demo.md', '', multiline].join('\n'),
                attachments: [],
                requireAllAttachments: true,
            },
        });
        await expect(feedback.inputValue()).resolves.toBe('');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('opens, deduplicates, switches, and closes real tabs through Workspace without losing an unsaved draft', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);

        const wide = page.getByTestId('wide-file-workspace');
        await expect(wide.getByLabel('Open existing file').count()).resolves.toBe(0);
        await wide.getByLabel('Workspace').click();
        await wide.getByTestId('machine-picker').waitFor();
        await wide.getByTestId('machine-picker').getByText('second.md', { exact: true }).click();
        await expect(wide.getByRole('tab').count()).resolves.toBe(2);

        await wide.getByRole('tab', { name: 'Open demo.md' }).click();
        await wide.getByRole('button', { name: 'Edit' }).click();
        const demoEditor = wide
            .getByTestId('desktop-file-panel:/workspace/demo.md')
            .getByTestId('code-editor');
        await demoEditor.fill('# Unsaved draft\n'.repeat(40));
        await demoEditor.evaluate((element) => { element.scrollTop = 120; });

        await wide.getByLabel('Workspace').click();
        await wide.getByTestId('machine-picker').waitFor();
        await wide.getByTestId('machine-picker').getByText('second.md', { exact: true }).click();
        await expect(wide.getByRole('tab').count()).resolves.toBe(2);
        await wide.getByRole('tab', { name: 'Open demo.md' }).click();
        await expect(demoEditor.inputValue()).resolves.toBe('# Unsaved draft\n'.repeat(40));
        await expect(demoEditor.evaluate((element) => element.scrollTop)).resolves.toBe(120);

        await wide.getByLabel('Close second.md').click();
        await expect(wide.getByRole('tab').count()).resolves.toBe(1);
        await expect(wide.getByRole('tab', { name: 'Open demo.md' }).count()).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__DELETE_RPC_COUNT__ ?? 0)).resolves.toBe(0);
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FILE_DELETED_COUNT__ ?? 0)).resolves.toBe(0);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('opens the real Workspace directory and shares its selected file as a canonical tab', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);

        const wide = page.getByTestId('wide-file-workspace');
        await wide.getByLabel('Workspace').click({ timeout: 3_000 });
        await expect(wide.getByTestId('machine-picker').isVisible()).resolves.toBe(true);
        await wide.getByTestId('desktop-file-workspace-picker-close').click({ timeout: 3_000 });
        await expect(wide.getByTestId('machine-picker').isVisible()).resolves.toBe(false);
        await expect(wide.getByRole('tab').count()).resolves.toBe(1);

        await wide.getByLabel('Workspace').click({ timeout: 3_000 });
        await wide.getByText('remote.md', { exact: true }).click({ timeout: 3_000 });
        await expect(wide.getByRole('tab', { name: 'Open remote.md' }).count()).resolves.toBe(1);
        await expect(wide.getByTestId('desktop-file-panel:/machine-root/remote.md').count()).resolves.toBe(1);
        await expect(page.evaluate(() => (window as any).__MACHINE_DIRECTORY_CALLS__ ?? [])).resolves.toContainEqual({
            machineId: 'machine-2', path: '/machine-root', depth: 1,
        });
        await expect(page.evaluate(() => (window as any).__MACHINE_READ_CALLS__ ?? [])).resolves.toContainEqual({
            machineId: 'machine-2', path: '/machine-root/remote.md',
        });

        const compact = page.getByTestId('zero-tab-workspace');
        await compact.getByRole('button', { name: 'Open Workspace' }).click({ timeout: 3_000 });
        await compact.getByTestId('desktop-file-workspace-fullscreen-header').waitFor();
        await expect(compact.getByTestId('zero-tab-machine-picker').isVisible()).resolves.toBe(true);
        await compact.getByTestId('desktop-file-workspace-picker-close').click({ timeout: 3_000 });
        await expect(compact.getByTestId('desktop-file-workspace').count()).resolves.toBe(0);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('uses one Human-visible Workspace entry and adds existing files and directories to the current chat', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);

        const entryPoints = page.getByTestId('desktop-workspace-entry-points');
        const sidebar = entryPoints.getByTestId('production-files-sidebar');
        const workspace = entryPoints.getByTestId('production-desktop-file-workspace');

        await sidebar.getByText('Changes', { exact: true }).click();
        await expect(sidebar.getByText('No changes', { exact: true }).isVisible()).resolves.toBe(true);

        await page.reload();
        await expect(sidebar.getByText('Chat Workspace', { exact: true }).count()).resolves.toBe(0);
        await expect(sidebar.getByText('Machine Workspace', { exact: true }).count()).resolves.toBe(0);
        await sidebar.getByText('Workspace', { exact: true }).click();
        await expect(workspace.getByTestId('production-machine-picker').isVisible()).resolves.toBe(true);
        await expect(workspace.getByText('remote.md', { exact: true }).isVisible()).resolves.toBe(true);
        await workspace.getByLabel('Add remote.md to message').click();
        await workspace.getByLabel('Add project to message').click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_CONTEXT_CALLS__ ?? [])).resolves.toEqual([
            {
                action: 'add',
                sessionId: 'ordinary-session',
                entry: {
                    path: '/machine-root/remote.md',
                    kind: 'file',
                    source: { kind: 'machine', machineId: 'machine-2' },
                },
            },
            {
                action: 'add',
                sessionId: 'ordinary-session',
                entry: {
                    path: '/machine-root/project',
                    kind: 'directory',
                    source: { kind: 'machine', machineId: 'machine-2' },
                },
            },
        ]);
        await workspace.getByText('remote.md', { exact: true }).click();
        await expect(workspace.getByRole('tab', { name: 'Open remote.md' }).count()).resolves.toBe(1);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});

async function sidebarDemoScreenshot(page: Page, evidenceDirectory: string): Promise<void> {
    await page.getByTestId('sidebar-demo').screenshot({
        path: resolve(evidenceDirectory, 'issue-181-standard.png'),
    });
}
