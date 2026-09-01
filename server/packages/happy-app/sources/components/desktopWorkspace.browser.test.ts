import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

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
        const glyph = { 'chevron-back': '‹', 'chevron-forward': '›', 'chevron-left': '‹', plus: '+', x: '×' };
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name }, glyph[name] ?? '•');
        Icon.glyphMap = {};
        export const Ionicons = Icon;
        export const Octicons = Icon;
    `,
    'expo-image': `
        import React from 'react';
        import { View } from 'react-native';
        export const Image = ({ style, testID }) => React.createElement(View, { style, testID, 'data-image': 'true' });
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
        export const useRouter = () => ({ back() {}, push() {} });
        export const useLocalSearchParams = () => ({});
        export const Stack = { Screen: () => null };
    `,
    'expo-router/drawer': `
        import React from 'react';
        import { View } from 'react-native';
        export const Drawer = ({ screenOptions, drawerContent }) => React.createElement(
            View,
            {
                testID: 'navigation-drawer',
                style: [{ position: 'absolute', top: 0, bottom: 0, left: 0 }, screenOptions.drawerStyle],
            },
            drawerContent ? drawerContent() : null,
        );
    `,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: true });`,
    '@/components/SidebarView': `
        import React from 'react';
        export const SidebarView = () => React.createElement(
            'div',
            {
                'data-testid': 'sidebar-content',
                style: { height: '100%', padding: 20, background: '#f5f5f5', color: '#555' },
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
    '@/hooks/useTauriZoom': `export const DEFAULT_APP_ZOOM = 1;`,
    '@/navigation/browserNavigation': `
        export const canRouteForward = () => false;
        export const canUseRouteBack = () => false;
        export const getNavigatorCanGoBack = () => false;
    `,
    '@/navigation/browserNavigationStore': `
        const state = { routeHistory: null, markRouteBack() {}, markRouteForward() {} };
        export const useBrowserNavigationStore = (selector) => selector(state);
        useBrowserNavigationStore.getState = () => state;
    `,
    '@/-session/sessionOverlayNav': `
        const state = { canBack: false, canForward: false, back: () => false, forward: () => false };
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
    '@/components/markdown/MarkdownView': `
        import React from 'react';
        export const MarkdownView = ({ markdown }) => React.createElement('div', { 'data-testid': 'markdown-preview' }, markdown);
    `,
    '@/components/diff/PierreDiffView': `export const PierreDiffView = () => null;`,
    '@/components/FileDocumentPreview': `export const FileDocumentPreview = () => null;`,
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
        const content = btoa('# Desktop workspace\\n');
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
            return machineId === 'machine-2' && (
                path === '/machine-root/remote.md' || path === '/machine-root/second.md'
            )
                ? { success: true, content }
                : { success: false, error: 'Unexpected Workspace read' };
        };
        export const machineWriteFile = async () => ({ success: true, hash: 'saved-hash' });
        export const sessionReadFile = async () => ({ success: true, content });
        export const sessionWriteFile = async () => ({ success: true, hash: 'saved-hash' });
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
    `,
    '@/components/layout': `export const layout = { maxWidth: 1200 };`,
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
            'files.failedToDelete': 'Failed to delete file',
            'files.failedToRead': 'Failed to read file',
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
            if (args.importer.endsWith('/FilesSidebar.tsx')) {
                const relativeStub = ({
                    './SideChatPanel': '@/components/SideChatPanel',
                    './AnimatedOverlay': '@/components/AnimatedOverlay',
                    './MobileGlass': '@/components/MobileGlass',
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
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            alias: { 'react-native': 'react-native-web' },
            loader: { '.png': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<style>html,body,#root{margin:0;min-height:100%;font-family:sans-serif}*{box-sizing:border-box}</style><main id="root"></main><script>' + script + '</script>');
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

    it('uses the real boundary toggle and pointer divider without overlapping or remounting', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(origin);
        await page.waitForTimeout(100);
        if (pageErrors.length > 0) throw new Error(`Browser fixture failed to render: ${pageErrors.join('\n')}`);

        const sidebarDemo = page.getByTestId('sidebar-demo');
        const drawer = page.getByTestId('navigation-drawer');
        const collapse = page.getByTestId('navigation-sidebar-toggle');
        await collapse.waitFor();
        await expect(collapse.getAttribute('aria-label')).resolves.toBe('Collapse navigation');
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
        const expand = page.getByTestId('navigation-sidebar-toggle');
        await expand.waitFor();
        await expect(expand.getAttribute('aria-label')).resolves.toBe('Expand navigation');
        const expandBox = await expand.boundingBox();
        const zenBox = await page.getByLabel('Toggle Zen mode').boundingBox();
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
        await expect(wide.getByTestId('markdown-preview').isVisible()).resolves.toBe(true);

        await wide.getByRole('button', { name: 'Edit' }).click();
        await expect(wide.getByTestId('code-editor').getAttribute('data-read-only')).resolves.toBe('false');
        await wide.getByRole('button', { name: 'Preview' }).click();
        await expect(wide.getByTestId('markdown-preview').isVisible()).resolves.toBe(true);
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
        await expect(narrow.getByTestId('markdown-preview').isVisible()).resolves.toBe(true);

        const evidenceDirectory = process.env.HAPPYHERD_ISSUE_181_EVIDENCE_DIR;
        if (evidenceDirectory) {
            await sidebarDemoScreenshot(page, evidenceDirectory);
            await page.getByTestId('split-demo').screenshot({ path: resolve(evidenceDirectory, 'issue-181-wide.png') });
            await narrow.screenshot({ path: resolve(evidenceDirectory, 'issue-181-mobile.png') });
        }
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
