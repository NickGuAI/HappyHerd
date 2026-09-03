import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
        const colors = new Proxy({
            text: '#111', textSecondary: '#666', textDestructive: '#c00', textLink: '#06c',
            divider: '#ddd', surface: '#fff', surfaceHigh: '#f3f3f3', warning: '#a60',
            groupped: { background: '#f5f5f5' }, input: { background: '#eee' },
            header: { background: '#fff', tint: '#111' },
            button: { primary: { background: '#111', tint: '#fff' } },
            success: '#0a0', surfaceSelected: '#eee',
            glass: { overlay: '#fff', overlayTint: '#fff', backgroundStrong: '#fff', border: '#ddd' },
            shadow: { color: '#000', opacity: 0.2 },
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
        export const sync = {
            applySettings() {},
            sendMessage: async (sessionId, text, options) => {
                window.__WORKSPACE_FEEDBACK_CALLS__ = [
                    ...(window.__WORKSPACE_FEEDBACK_CALLS__ ?? []),
                    { sessionId, text, options },
                ];
                return { localId: 'feedback-local-id' };
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
        export const dismissWorkspaceLinkToOrigin = () => undefined;
        export const useWorkspaceLinkDismissGuard = () => ({ onSendingChange() {}, onDirtyChange() {}, guardDismiss: (action) => action() });
        export const useWorkspaceLinkPress = () => (route) => {
            window.__WORKSPACE_LINK_CALLS__ = [...(window.__WORKSPACE_LINK_CALLS__ ?? []), route];
        };
    `,
    '@/components/layout': `export const layout = { maxWidth: 1200, headerMaxWidth: 800 };`,
    '@/text': `
        export const t = (key, params) => ({
            'common.back': 'Back',
            'common.cancel': 'Cancel',
            'common.error': 'Error',
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
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            alias: { 'react-native': 'react-native-web' },
            loader: { '.png': 'dataurl', '.ttf': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
        const stylesheet = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<style>html,body,#root{margin:0;min-height:100%;font-family:sans-serif}*{box-sizing:border-box}' + stylesheet + '</style><main id="root"></main><script>' + script + '</script>');
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

    async function verifyMarkdownReviewJourney(page: Page, surfaceId: string, feedbackIndex = 0, touch = false) {
        const workspace = page.getByTestId(surfaceId);
        const markdownPanel = workspace.getByTestId('desktop-file-panel:/workspace/demo.md');
        await markdownPanel.locator('.hh-markdown-root').waitFor();

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
            await markdownPanel.getByPlaceholder('Write a comment').fill(feedback);
            await markdownPanel.getByRole('button', { name: 'Pin comment' }).click();
        }
        await markdownPanel.getByRole('button', { name: 'Send 2 comments' }).click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(feedbackIndex + 1);
        const markdownFeedback = await page.evaluate((index) => (window as any).__WORKSPACE_FEEDBACK_CALLS__[index].text, feedbackIndex);
        expect(markdownFeedback).toContain('Line: 3');
        expect(markdownFeedback).toContain('First line note');
        expect(markdownFeedback).toContain('Line: 4');
        expect(markdownFeedback).toContain('Second line note');
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
        const [lineBox, scrollerBox] = await Promise.all([sourceLine.boundingBox(), codeScroller.boundingBox()]);
        if (!lineBox || !scrollerBox) throw new Error(`Source line ${line} has no browser layout box`);
        const point = {
            x: Math.min(scrollerBox.x + Math.max(100, scrollerBox.width / 2), scrollerBox.x + scrollerBox.width - 12),
            y: lineBox.y + (lineBox.height / 2),
        };
        if (touch) {
            await page.touchscreen.tap(point.x, point.y);
        } else {
            await page.mouse.move(point.x, point.y);
            await expect(sourcePanel.getByRole('button', { name: 'Comment on hovered line' }).isVisible()).resolves.toBe(true);
            await page.mouse.click(point.x, point.y);
        }
        await sourcePanel.getByPlaceholder('Write a comment').waitFor();
        await expect(sourcePanel.getByText(`Comment on line ${line}`, { exact: true }).count()).resolves.toBe(1);
        await expect.poll(() => sourceLine.getAttribute('data-selected-line')).toBe('single');
    }

    async function verifyMarkdownSourceReviewJourney(page: Page, surfaceId: string, touch = false, switchTab = true) {
        const workspace = page.getByTestId(surfaceId);
        if (switchTab) await workspace.getByRole('tab', { name: 'Open source.md' }).click();
        const sourcePanel = workspace.getByTestId('desktop-file-panel:/workspace/source.md');
        // A line-linked Markdown deep link stays rendered as a Preview; it never
        // falls back to the raw source renderer.
        await expect(sourcePanel.locator('diffs-container').count()).resolves.toBe(0);
        const heading = sourcePanel.locator('h1', { hasText: 'Source review' });
        await heading.waitFor();
        await expect(sourcePanel.locator('.hh-markdown-root').count()).resolves.toBeGreaterThan(0);
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

    async function verifyCodeReviewJourney(page: Page, surfaceId: string, feedbackIndex: number, switchTab = true, touch = false) {
        const workspace = page.getByTestId(surfaceId);
        if (switchTab) await workspace.getByRole('tab', { name: 'Open review.ts' }).click();
        const sourcePanel = workspace.getByTestId('desktop-file-panel:/workspace/review.ts');
        await sourcePanel.locator('diffs-container').waitFor();

        const codeScroller = sourcePanel.locator('[data-code]');
        await expect.poll(() => codeScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        if (!touch) {
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
                : line === 3 ? 'Long line note' : null;
            if (feedback) {
                await sourcePanel.getByPlaceholder('Write a comment').fill(feedback);
                await sourcePanel.getByRole('button', { name: 'Pin comment' }).click();
            } else {
                await sourcePanel.getByRole('button', { name: 'Cancel' }).click();
            }
        }

        await sourcePanel.getByRole('button', { name: 'Send 2 comments' }).click();
        await expect(page.evaluate(() => (window as any).__WORKSPACE_FEEDBACK_CALLS__ ?? [])).resolves.toHaveLength(feedbackIndex + 1);
        const sourceFeedback = await page.evaluate((index) => (window as any).__WORKSPACE_FEEDBACK_CALLS__[index].text, feedbackIndex);
        expect(sourceFeedback).toContain('Line: 2');
        expect(sourceFeedback).toContain('Blank line note');
        expect(sourceFeedback).toContain('Line: 3');
        expect(sourceFeedback).toContain('Long line note');

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
            await canvasPanel.getByPlaceholder('Write a comment').fill(feedback);
            await canvasPanel.getByRole('button', { name: 'Pin comment' }).click();
        }
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

    it('pins and sends Markdown and JSON Canvas review feedback in the production Web Desktop host', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin + '?file-review=desktop');
        await verifyMarkdownReviewJourney(page, 'file-review-desktop');
        await verifyMachineMarkdownLinkJourney(page, 'file-review-desktop');
        await verifyCodeReviewJourney(page, 'file-review-desktop', 1);
        await verifyMarkdownSourceReviewJourney(page, 'file-review-desktop');
        await verifyCanvasReviewJourney(page, 'file-review-desktop', true, 2);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 60_000);

    it('pins and sends the same review feedback in the production 390x844 Web Mobile host', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        const pageErrors = recordPageErrors(page);
        await page.goto(origin + '?file-review=mobile');
        await verifyMarkdownReviewJourney(page, 'file-review-mobile', 0, true);
        await page.goto(origin + '?file-review=mobile-canvas');
        await verifyCanvasReviewJourney(page, 'file-review-mobile', false, 0, true);
        await page.goto(origin + '?file-review=mobile-source');
        await verifyCodeReviewJourney(page, 'file-review-mobile', 0, false, true);
        await page.goto(origin + '?file-review=mobile-markdown-source');
        await verifyMarkdownSourceReviewJourney(page, 'file-review-mobile', true, false);
        expect(pageErrors).toEqual([]);
        await page.close();
        await context.close();
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
