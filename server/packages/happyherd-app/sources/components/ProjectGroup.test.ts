import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectGroupData, SessionRowData } from '@/sync/storage';

const mocks = vi.hoisted(() => ({
    router: { navigate: vi.fn() },
    draft: {
        setMachineId: vi.fn(),
        setPath: vi.fn(),
        setSessionType: vi.fn(),
        setWorktreeKey: vi.fn(),
    },
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => ('ios' in spec ? spec.ios : spec.default) },
        Pressable: host('Pressable'),
        View: host('View'),
    };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => mocks.router }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            groupped: { sectionTitle: 'section-title' },
            text: 'text',
            textSecondary: 'secondary',
            surface: 'surface',
            surfaceHighest: 'surface-highest',
            divider: 'divider',
            shadow: { color: 'shadow', opacity: 0 },
        },
        borderRadius: { xl: 12 },
    };
    return {
        StyleSheet: { hairlineWidth: 1, create: (factory: any) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/components/StyledText', () => ({ Text: () => null }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/storage', () => ({ useSessionGitStatus: () => null }));
vi.mock('@/hooks/useNewSessionDraft', () => ({ useNewSessionDraft: { getState: () => mocks.draft } }));
vi.mock('@/utils/sessionUtils', () => ({ formatPathRelativeToHome: (path: string) => path }));
vi.mock('./ActiveSessionsGroupCompact', () => ({ CompactSessionRow: () => null }));
vi.mock('./Avatar', () => ({ Avatar: () => null }));
vi.mock('./GitLineChanges', () => ({ GitLineChanges: () => null }));

import { ProjectGroup } from './ProjectGroup';
import { registerHomeDockFocusListener } from './homeDockFocus';
import { useHerdPhoneShell } from './herd/shell/phoneShell';

// Only the fields the group header reads; the real rows are built in storage.ts.
const session = {
    id: 'session-1',
    avatarId: 'avatar-1',
    machineId: 'machine-1',
    path: '/home/test/repo',
    homeDir: '/home/test',
    gitChangedFiles: null,
} as SessionRowData;

const project: ProjectGroupData = {
    id: 'project-1',
    name: 'repo',
    machineId: 'machine-1',
    workspaces: [{ id: '', name: null, sessions: [session] }],
    sessionCount: 1,
    activeCount: 1,
};

let renderer: ReturnType<typeof create>;
let drawerOpenOnNavigate: boolean[];

function pressNewSession() {
    act(() => renderer.root.findByProps({ accessibilityLabel: 'sidebar.newSession' }).props.onPress());
}

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    drawerOpenOnNavigate = [];
    mocks.router.navigate.mockImplementation(() => {
        drawerOpenOnNavigate.push(useHerdPhoneShell.getState().drawerOpen);
    });
    act(() => { renderer = create(React.createElement(ProjectGroup, { project })); });
    act(() => useHerdPhoneShell.getState().openDrawer());
});
afterEach(() => {
    act(() => renderer.unmount());
    act(() => useHerdPhoneShell.getState().closeDrawer());
});

describe('workspace group new session', () => {
    it('closes the phone drawer before it opens New Session', () => {
        pressNewSession();
        expect(useHerdPhoneShell.getState().drawerOpen).toBe(false);
        expect(mocks.router.navigate).toHaveBeenCalledExactlyOnceWith('/new');
        expect(drawerOpenOnNavigate).toEqual([false]);
    });

    it('closes the phone drawer when the home dock opens the composer instead', () => {
        const release = registerHomeDockFocusListener();
        try {
            pressNewSession();
            expect(useHerdPhoneShell.getState().drawerOpen).toBe(false);
            expect(mocks.router.navigate).not.toHaveBeenCalled();
        } finally {
            release();
        }
    });
});
