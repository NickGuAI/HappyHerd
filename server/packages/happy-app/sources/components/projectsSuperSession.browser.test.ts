import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

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
        const theme = {
            dark: false,
            colors: {
                divider: '#dedede', surface: '#fff', surfaceHigh: '#f3f3f3', surfaceHighest: '#eee',
                surfacePressed: '#ececec', surfacePressedOverlay: '#ececec', surfaceSelected: '#e8eef9',
                surfaceRipple: '#ececec', text: '#181818', textSecondary: '#676767', textDestructive: '#c22',
                textLink: '#2868c7', groupped: { background: '#f7f7f7', chevron: '#777', sectionTitle: '#666' },
                glass: { border: '#ddd', divider: '#ddd' }, shadow: { color: '#000', opacity: 0.08 },
                status: { error: '#c22' },
            },
        };
        export const StyleSheet = {
            create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory,
            hairlineWidth: 1,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name, 'aria-hidden': true }, '•');
        Icon.glyphMap = {};
        export const Ionicons = Icon;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'react-native-gesture-handler': `
        import React from 'react';
        export const Swipeable = React.forwardRef(({ children }, _ref) => children);
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    'expo-router': `
        import React from 'react';
        const initialScreen = new URLSearchParams(window.location.search).get('screen');
        let pathname = initialScreen === 'assignment' ? '/session/ordinary-session/project' : '/';
        const listeners = new Set();
        const emit = () => listeners.forEach((listener) => listener());
        const record = (path) => {
            window.__ROUTER_CALLS__ = [...(window.__ROUTER_CALLS__ ?? []), path];
            if (path === '/projects' || path.endsWith('/project')) {
                pathname = path;
                emit();
            }
        };
        const router = {
            navigate: record,
            push: record,
            back() { window.__ROUTER_BACK_COUNT__ = (window.__ROUTER_BACK_COUNT__ ?? 0) + 1; },
        };
        export const useRouter = () => router;
        export const usePathname = () => React.useSyncExternalStore(
            (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            () => pathname,
            () => pathname,
        );
        export const useLocalSearchParams = () => ({ id: pathname.split('/')[2] ?? '' });
        export const Stack = { Screen: () => null };
    `,
    '@/sync/storage': `
        import React from 'react';
        const row = (id, name, lastActivityAt, projectName) => ({
            id, name, subtitle: '', avatarId: id, flavor: 'codex', clientId: null,
            identityLine: 'Codex', providerKind: 'codex', modelName: null, activitySummary: null,
            gitChangedFiles: null, gitCountsExact: true, gitDeletions: null, gitInsertions: null,
            state: 'waiting', createdAt: id === 'super-session' ? 1 : 2, lastActivityAt,
            updateSequence: lastActivityAt, hasDraft: false, active: true, archived: false,
            machineId: 'machine-1', daemonLabel: 'Main machine', daemonShortId: 'machine-1',
            commanderId: id === 'super-session' ? 'assistant' : null,
            commanderName: id === 'super-session' ? 'HappyHerd' : null,
            machineOffline: false, path: id === 'super-session' ? '/assistant' : '/work/current',
            homeDir: '/work', completedTodosCount: 0, totalTodosCount: 0, hasUnread: false,
            projectId: id === 'ordinary-session' ? 'project-alpha' : null,
            projectName, workspaceId: null, workspaceName: null,
        });
        const superRow = row('super-session', 'Persistent assistant source title', 1, 'Assistant');
        const ordinaryRow = row('ordinary-session', 'Newest ordinary session', 999, 'Project Alpha');
        let projects = {
            'project-alpha': {
                id: 'project-alpha', externalId: 'external-alpha', name: 'Project Alpha', kind: 'personal',
                metadataVersion: 1, avatar: null, createdAt: 1, updatedAt: 1,
            },
            'empty-project': {
                id: 'empty-project', externalId: 'external-empty', name: 'Roadmap', kind: 'personal',
                metadataVersion: 1, avatar: null, createdAt: 2, updatedAt: 2,
            },
        };
        let sessions = {
            'super-session': {
                id: 'super-session', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
                presence: 'online', projectId: null,
                metadata: { path: '/assistant', machineId: 'machine-1', isSuperSession: true },
            },
            'ordinary-session': {
                id: 'ordinary-session', seq: 999, createdAt: 2, updatedAt: 999, active: true, activeAt: 999,
                presence: 'online', projectId: 'project-alpha',
                metadata: { path: '/work/current', machineId: 'machine-1' },
            },
        };
        let sessionList = Object.values(sessions);
        const settings = { hideInactiveSessions: true, sessionListGrouping: 'flat', machineWorkspace: true };
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        const listData = [
            {
                type: 'project', source: 'personal',
                project: {
                    id: 'project-alpha', name: 'Project Alpha', machineId: null,
                    activeCount: 1, sessionCount: 1,
                    workspaces: [{ id: '', name: null, sessions: [ordinaryRow] }],
                },
            },
            { type: 'super-session', session: superRow },
        ];
        export const storage = { getState: () => ({ sessions, projects }) };
        export const useSessionListViewData = () => listData;
        export const useSetting = (key) => settings[key];
        export const useSettingMutable = (key) => [settings[key], (value) => { settings[key] = value; emit(); }];
        export const useAllMachines = () => [{ id: 'machine-1', active: true, metadata: { displayName: 'Main machine' } }];
        export const useRealtimeStatus = () => 'disconnected';
        export const useProjects = () => React.useSyncExternalStore(subscribe, () => projects, () => projects);
        export const useAllSessions = () => React.useSyncExternalStore(subscribe, () => sessionList, () => sessionList);
        export const useSession = (id) => React.useSyncExternalStore(
            subscribe, () => sessions[id] ?? null, () => sessions[id] ?? null,
        );
        export const __createProject = (name) => {
            const id = 'created-project';
            projects = { ...projects, [id]: {
                id, externalId: 'external-created', name, kind: 'personal', metadataVersion: 1,
                avatar: null, createdAt: 3, updatedAt: 3,
            } };
            emit();
            return projects[id];
        };
        export const __renameProject = (id, name) => {
            projects = { ...projects, [id]: { ...projects[id], name, metadataVersion: projects[id].metadataVersion + 1 } };
            emit();
            return projects[id];
        };
        export const __assignProject = (sessionId, projectId) => {
            sessions = { ...sessions, [sessionId]: { ...sessions[sessionId], projectId } };
            sessionList = Object.values(sessions);
            emit();
        };
    `,
    '@/sync/sync': `
        import { __assignProject, __createProject, __renameProject } from '@/sync/storage';
        export const sync = {
            async createProject(name) {
                window.__PROJECT_CREATE_CALLS__ = [...(window.__PROJECT_CREATE_CALLS__ ?? []), name];
                return __createProject(name);
            },
            async renameProject(id, name) {
                window.__PROJECT_RENAME_CALLS__ = [...(window.__PROJECT_RENAME_CALLS__ ?? []), { id, name }];
                return __renameProject(id, name);
            },
            async assignSessionProject(sessionId, projectId) {
                window.__PROJECT_ASSIGN_CALLS__ = [...(window.__PROJECT_ASSIGN_CALLS__ ?? []), { sessionId, projectId }];
                __assignProject(sessionId, projectId);
            },
        };
    `,
    '@/text': `
        export const t = (key, params) => ({
            'sidebar.newSession': 'New Session', 'sidebar.projects': 'Projects',
            'sidebar.showArchived': 'Show Archived', 'sidebar.hideArchived': 'Hide Archived',
            'workspace.title': 'Workspace', 'happyHerd.automations.title': 'Automations',
            'settings.title': 'Settings', 'status.unknown': 'Unknown',
            'superSession.pinned': 'Super Session (Pinned)',
            'projects.create': 'Create Project', 'projects.createTitle': 'Create New Project',
            'projects.createPrompt': 'Enter project name', 'projects.renameTitle': 'Rename Project',
            'projects.renamePrompt': 'Enter a new name for ' + (params?.name ?? ''),
            'projects.emptyDescription': 'Projects persist across your devices and are independent of machines or working directories. Create one to organize your sessions.',
            'projects.project': 'Project', 'projects.noProject': 'No Project',
            'projects.sessionCount': (params?.count ?? 0) + ((params?.count ?? 0) === 1 ? ' session' : ' sessions'),
            'common.rename': 'Rename', 'common.error': 'Error',
            'happyHerd.automations.unknownError': 'Something went wrong',
        }[key] ?? key);
    `,
    '@/modal': `
        export const Modal = {
            alert() {},
            async prompt(_title, message, options) {
                return window.prompt(message, options?.defaultValue ?? '');
            },
        };
    `,
    '@/constants/Typography': `export const Typography = { default: () => ({}) };`,
    '@/components/StyledText': `export { Text } from 'react-native';`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    '@/components/BubblePressable': `import { Pressable } from 'react-native'; export const BubblePressable = Pressable;`,
    '@/components/SessionActionsPopover': `export const SessionActionsPopover = () => null;`,
    '@/components/ShortcutHints': `
        export const SessionShortcutHintBadge = () => null;
        export const ShortcutHintBadge = () => null;
        export const useShortcutHints = () => ({ visible: false });
    `,
    '@/components/RigGitLineChanges': `export const RigGitLineChanges = () => null;`,
    '@/components/SessionStatusAvatar': `
        import React from 'react';
        export const SessionStatusAvatar = ({ commanderName, size }) => React.createElement(
            'span',
            { 'data-testid': 'session-avatar', style: { display: 'inline-flex', width: size, height: size, borderRadius: size, alignItems: 'center', justifyContent: 'center', background: '#e5e5e5' } },
            commanderName?.slice(0, 1) ?? 'S',
        );
    `,
    '@/hooks/useSessionQuickActions': `export const useSessionActionAlert = () => () => {};`,
    '@/hooks/useHappyAction': `export const useHappyAction = (action) => [false, action];`,
    '@/sync/ops': `export const sessionKill = async () => ({ success: true });`,
    '@/utils/errors': `export class HappyError extends Error {}`,
    '@/track': `export const trackSessionSwitched = () => {};`,
    '@/utils/requestReview': `export const requestReview = () => {};`,
    '@/components/UpdateBanner': `export const UpdateBanner = () => null;`,
    '@/components/ActiveSessionsGroupCompact': `export const ActiveSessionsGroupCompact = () => null;`,
    '@/components/ProjectGroup': `export const ProjectGroup = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null;`,
    '@/components/MainViewFixture': `
        import React from 'react';
        import { SessionsList } from '@/components/SessionsList';
        export const MainView = () => React.createElement(SessionsList, { bottomContentInset: 12 });
    `,
    '@/utils/responsive': `
        export const useHeaderHeight = () => 0;
        export const useIsTablet = () => window.innerWidth >= 768;
        export const getDeviceType = () => window.innerWidth >= 768 ? 'tablet' : 'phone';
    `,
};

const fixturePlugin: Plugin = {
    name: 'projects-super-session-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === './MainView' && args.importer.endsWith('/components/SidebarView.tsx')) {
                return { path: '@/components/MainViewFixture', namespace: 'fixture-stub' };
            }
            const relativeStubs: Record<string, string> = {
                './ActiveSessionsGroupCompact': '@/components/ActiveSessionsGroupCompact',
                './ProjectGroup': '@/components/ProjectGroup',
                './UpdateBanner': '@/components/UpdateBanner',
                './SessionActionsPopover': '@/components/SessionActionsPopover',
                './ShortcutHints': '@/components/ShortcutHints',
                './RigGitLineChanges': '@/components/RigGitLineChanges',
                './SessionStatusAvatar': '@/components/SessionStatusAvatar',
                './VoiceAssistantStatusBar': '@/components/VoiceAssistantStatusBar',
                './BubblePressable': '@/components/BubblePressable',
            };
            if (args.path in relativeStubs) {
                const replacement = relativeStubs[args.path];
                return { path: replacement, namespace: 'fixture-stub' };
            }
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

describe('Projects and Super Session production UI gestures', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import { usePathname } from 'expo-router';
                    import { SidebarView } from '@/components/SidebarView';
                    import { SessionsList } from '@/components/SessionsList';
                    import ProjectsScreen from '@/app/(app)/projects/index';
                    import SessionProjectScreen from '@/app/(app)/session/[id]/project';

                    function Fixture() {
                        const pathname = usePathname();
                        if (pathname === '/projects') return React.createElement(ProjectsScreen);
                        if (pathname.endsWith('/project')) return React.createElement(SessionProjectScreen);
                        const mobile = new URLSearchParams(window.location.search).get('mobile') === '1';
                        return mobile
                            ? React.createElement(SessionsList, { bottomContentInset: 12 })
                            : React.createElement('aside', { 'data-testid': 'desktop-sidebar', style: { width: 390, height: '100%' } }, React.createElement(SidebarView));
                    }
                    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
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
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
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

    it('pins one stable existing assistant row below desktop navigation and first on mobile', async () => {
        for (const surface of [
            { name: 'desktop', query: '', viewport: { width: 1440, height: 900 } },
            { name: 'mobile', query: '?mobile=1', viewport: { width: 390, height: 844 } },
        ] as const) {
            const page = await browser.newPage({ viewport: surface.viewport });
            page.setDefaultTimeout(2_000);
            page.setDefaultNavigationTimeout(4_000);
            const pageErrors: string[] = [];
            page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
            await page.goto(`${origin}/${surface.query}`);

            const pinned = page.getByText('Super Session (Pinned)', { exact: true });
            const ordinary = page.getByText('Newest ordinary session', { exact: true });
            await pinned.waitFor({ state: 'visible' }).catch(async (error) => {
                throw new Error(`${String(error)}\nBody:\n${await page.locator('body').innerText()}\nBrowser errors:\n${pageErrors.join('\n')}`);
            });
            await ordinary.waitFor({ state: 'visible' });
            const [pinnedBox, ordinaryBox] = await Promise.all([pinned.boundingBox(), ordinary.boundingBox()]);
            expect(pinnedBox).not.toBeNull();
            expect(ordinaryBox).not.toBeNull();
            expect(pinnedBox!.y).toBeLessThan(ordinaryBox!.y);

            if (surface.name === 'desktop') {
                const labels = ['New Session', 'Workspace', 'Projects', 'Automations'];
                const navigationBoxes = await Promise.all(labels.map((label) => (
                    page.getByRole('button', { name: label, exact: true }).boundingBox()
                )));
                navigationBoxes.forEach((box) => expect(box).not.toBeNull());
                expect(navigationBoxes.map((box) => box!.y)).toEqual(
                    [...navigationBoxes.map((box) => box!.y)].sort((a, b) => a - b),
                );
                expect(navigationBoxes.at(-1)!.y).toBeLessThan(pinnedBox!.y);
            }

            await pinned.click();
            await pinned.click();
            await expect(page.evaluate(() => (window as any).__ROUTER_CALLS__)).resolves.toEqual([
                '/session/super-session',
                '/session/super-session',
            ]);
            await expect(page.evaluate(() => (window as any).__PROJECT_CREATE_CALLS__ ?? [])).resolves.toEqual([]);

            const evidenceDirectory = process.env.HAPPYHERD_PROJECTS_EVIDENCE_DIR?.trim();
            if (evidenceDirectory) {
                mkdirSync(resolve(evidenceDirectory), { recursive: true });
                await page.screenshot({ path: resolve(evidenceDirectory, `super-session-${surface.name}.png`), fullPage: true });
            }
            expect(pageErrors).toEqual([]);
            await page.close();
        }
    }, 15_000);

    it('creates and renames independent projects from the production Projects screen', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(2_000);
        page.setDefaultNavigationTimeout(4_000);
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.goto(origin);
        await page.getByRole('button', { name: 'Projects', exact: true }).click();

        await expect(page.getByText('Roadmap', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('0 sessions', { exact: true }).count()).resolves.toBe(1);

        page.once('dialog', (dialog) => dialog.accept('Client launch'));
        await page.getByText('Create Project', { exact: true }).click();
        await page.getByText('Client launch', { exact: true }).waitFor();

        page.once('dialog', (dialog) => dialog.accept('Launch plan'));
        await page.getByText('Client launch', { exact: true }).click();
        await page.getByText('Launch plan', { exact: true }).waitFor();

        await expect(page.evaluate(() => (window as any).__PROJECT_CREATE_CALLS__)).resolves.toEqual(['Client launch']);
        await expect(page.evaluate(() => (window as any).__PROJECT_RENAME_CALLS__)).resolves.toEqual([
            { id: 'created-project', name: 'Launch plan' },
        ]);
        const evidenceDirectory = process.env.HAPPYHERD_PROJECTS_EVIDENCE_DIR?.trim();
        if (evidenceDirectory) {
            mkdirSync(resolve(evidenceDirectory), { recursive: true });
            await page.screenshot({ path: resolve(evidenceDirectory, 'projects-management.png'), fullPage: true });
        }
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('assigns an existing session to a selected project from the production selector', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(2_000);
        page.setDefaultNavigationTimeout(4_000);
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.goto(`${origin}/?screen=assignment`);

        const evidenceDirectory = process.env.HAPPYHERD_PROJECTS_EVIDENCE_DIR?.trim();
        if (evidenceDirectory) {
            mkdirSync(resolve(evidenceDirectory), { recursive: true });
            await page.screenshot({ path: resolve(evidenceDirectory, 'session-project-selector.png'), fullPage: true });
        }
        await page.getByText('Roadmap', { exact: true }).click();
        await expect(page.evaluate(() => (window as any).__PROJECT_ASSIGN_CALLS__)).resolves.toEqual([
            { sessionId: 'ordinary-session', projectId: 'empty-project' },
        ]);
        await expect(page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__)).resolves.toBe(1);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});
