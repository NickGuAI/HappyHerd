vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const localSettings = { navigationSidebarCollapsed: false, zenMode: false };
const applyLocalSettings = vi.fn((delta: Partial<typeof localSettings>) => Object.assign(localSettings, delta));

vi.mock('react-native', () => ({
    Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    Modal: 'Modal',
    useWindowDimensions: () => ({ width: 1440, height: 900 }),
}));
vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => true }));
vi.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect' }));
vi.mock('react-native-safe-area-context', async () => {
    const ReactModule = await import('react');
    const SafeAreaInsetsContext = ReactModule.createContext({ top: 0, right: 0, bottom: 0, left: 0 });
    return { SafeAreaInsetsContext, useSafeAreaInsets: () => ReactModule.useContext(SafeAreaInsetsContext) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/hooks/useNewSessionDraft', () => ({ useNewSessionDraft: () => null }));
vi.mock('react-native-unistyles', () => {
    const theme = new Proxy({}, { get: () => theme });
    return {
        StyleSheet: { create: (factory: any) => (typeof factory === 'function' ? factory(theme) : factory) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({ localSettings, applyLocalSettings }) },
    useAllMachines: () => [],
    useLocalSetting: () => false,
    useSessionListViewData: () => null,
}));
vi.mock('@/text', () => ({
    t: (key: string) => ({
        'agentInput.agent.claude': 'Claude',
        'agentInput.agent.codex': 'Codex',
        'agentInput.agent.gemini': 'Gemini',
        'agentInput.agent.grok': 'GrokBuild',
        'agentInput.agent.dsh': 'dsh',
    } as Record<string, string>)[key] ?? key,
}));

import { resolveHerdPopoverPosition } from '../HerdPopover';
import { orderMachinesForMenu } from './HerdMachineMenu';
import { resolveNewSessionMachine } from '@/utils/newSessionMachine';
import { resolveHerdSidebarEdgeToggleLeft } from './HerdSidebarEdgeToggle';
import { resolveSelectionGlideStart } from './selectionGlide';
import { resolveHerdRowAgentLabel, resolveHerdRowAttention } from './sessionRowPresentation';
import {
    formatSidebarToggleShortcut,
    HERD_SIDEBAR_TOGGLE_SHORTCUT,
    toggleNavigationSidebarCollapsed,
} from './sidebarShortcut';
import { HERD_SIDEBAR_EXIT_MS, useHerdSidebarTransition } from './sidebarTransition';
import { matchesShortcutChord } from '@/keyboard/shortcuts';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { HerdWindowInsetsContext, useWindowSafeAreaInsets } from './windowInsets';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('panel collapse sequencing', () => {
    function mountTransition(initialHidden: boolean) {
        const seen: Array<{ widthHidden: boolean; phase: string }> = [];
        function Probe({ hidden }: { hidden: boolean }) {
            seen.push(useHerdSidebarTransition(hidden));
            return null;
        }
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { hidden: initialHidden })); });
        return {
            latest: () => seen[seen.length - 1],
            setHidden: (hidden: boolean) => act(() => renderer.update(React.createElement(Probe, { hidden }))),
            seen,
        };
    }

    it('starts from the persisted state without playing a transition', () => {
        vi.useFakeTimers();
        expect(mountTransition(true).latest()).toEqual({ widthHidden: true, phase: 'idle' });
        expect(mountTransition(false).latest()).toEqual({ widthHidden: false, phase: 'idle' });
    });

    it('lets the content leave before the width snaps shut', () => {
        vi.useFakeTimers();
        const probe = mountTransition(false);
        probe.setHidden(true);
        expect(probe.latest()).toEqual({ widthHidden: false, phase: 'exiting' });
        act(() => { vi.advanceTimersByTime(HERD_SIDEBAR_EXIT_MS); });
        expect(probe.latest()).toEqual({ widthHidden: true, phase: 'idle' });
    });

    it('opens the width at once and lets the content slide in', () => {
        vi.useFakeTimers();
        const probe = mountTransition(true);
        probe.setHidden(false);
        expect(probe.latest()).toEqual({ widthHidden: false, phase: 'entering' });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(probe.latest()).toEqual({ widthHidden: false, phase: 'idle' });
    });

    it('re-opens cleanly when expanded again mid-collapse', () => {
        vi.useFakeTimers();
        const probe = mountTransition(false);
        probe.setHidden(true);
        probe.setHidden(false);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(probe.latest()).toEqual({ widthHidden: false, phase: 'idle' });
        expect(probe.seen.some((state) => state.widthHidden)).toBe(false);
    });
});

describe('⌥⌘B panel shortcut', () => {
    const event = (overrides: Partial<Parameters<typeof matchesShortcutChord>[0]>) => ({
        key: '∫', code: 'KeyB', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides,
    });

    it('matches Option-Command-B on macOS and Ctrl-Alt-B elsewhere', () => {
        expect(matchesShortcutChord(event({ metaKey: true, altKey: true }), 'meta', HERD_SIDEBAR_TOGGLE_SHORTCUT)).toBe(true);
        expect(matchesShortcutChord(event({ ctrlKey: true, altKey: true }), 'control', HERD_SIDEBAR_TOGGLE_SHORTCUT)).toBe(true);
        expect(matchesShortcutChord(event({ metaKey: true }), 'meta', HERD_SIDEBAR_TOGGLE_SHORTCUT)).toBe(false);
        expect(matchesShortcutChord(event({ metaKey: true, altKey: true, shiftKey: true }), 'meta', HERD_SIDEBAR_TOGGLE_SHORTCUT)).toBe(false);
        expect(formatSidebarToggleShortcut('meta')).toBe('⌥⌘B');
        expect(formatSidebarToggleShortcut('control')).toBe('Ctrl+Alt+B');
    });

    it('flips only the collapse setting and leaves Zen alone', () => {
        localSettings.navigationSidebarCollapsed = false;
        localSettings.zenMode = true;
        toggleNavigationSidebarCollapsed();
        expect(localSettings).toEqual({ navigationSidebarCollapsed: true, zenMode: true });
        toggleNavigationSidebarCollapsed();
        expect(localSettings.navigationSidebarCollapsed).toBe(false);
    });
});

describe('edge handle and popover geometry', () => {
    it('straddles the open panel edge and rests at the window edge once collapsed', () => {
        expect(resolveHerdSidebarEdgeToggleLeft(360)).toBe(348);
        expect(resolveHerdSidebarEdgeToggleLeft(0)).toBe(6);
    });

    it('opens popovers under their trigger and keeps them inside the window', () => {
        const anchor = { x: 1300, y: 10, width: 120, height: 34 };
        expect(resolveHerdPopoverPosition({ anchor, width: 300, align: 'end', windowWidth: 1440, windowHeight: 900 }))
            .toEqual({ left: 1120, width: 300, top: 52, maxHeight: 836 });
        expect(resolveHerdPopoverPosition({ anchor: { ...anchor, x: 1400 }, width: 300, align: 'start', windowWidth: 1440, windowHeight: 900 }).left)
            .toBe(1128);
        expect(resolveHerdPopoverPosition({ anchor: { ...anchor, x: 0 }, width: 300, align: 'end', windowWidth: 1440, windowHeight: 900 }).left)
            .toBe(12);
        // Phones keep 8 px from the edges, and a wide popover shrinks to the window less those margins.
        expect(resolveHerdPopoverPosition({ anchor: { x: 330, y: 50, width: 52, height: 44 }, width: 380, align: 'end', windowWidth: 390, windowHeight: 844, margin: 8 }))
            .toEqual({ left: 8, width: 374, top: 102, maxHeight: 734 });
    });
});

describe('selection glide', () => {
    const rect = (top: number, height = 81, left = 8, width = 344) => ({ top, left, width, height });

    it('starts the highlight over the previous row in the same column', () => {
        expect(resolveSelectionGlideStart(rect(100), rect(262), 900)).toEqual({ offsetY: -162, height: 81 });
        expect(resolveSelectionGlideStart(rect(400, 97), rect(100), 900)).toEqual({ offsetY: 300, height: 97 });
    });

    it('simply appears for another column, the same row, or a distant jump', () => {
        expect(resolveSelectionGlideStart(rect(100, 81, 400), rect(262), 900)).toBeNull();
        expect(resolveSelectionGlideStart(rect(100), rect(100), 900)).toBeNull();
        expect(resolveSelectionGlideStart(rect(0), rect(2000), 900)).toBeNull();
    });
});

describe('top bar machine menu', () => {
    const machine = (id: string, active: boolean) => ({ id, active, metadata: { host: id } }) as any;

    it('shows exactly the machine New Session starts on', () => {
        const machines = [machine('offline-newest', false), machine('online-b', true)];
        // A fresh draft takes the newest machine, online or not, like New Session.
        expect(resolveNewSessionMachine(machines, null)).toEqual({ id: 'offline-newest', machine: machines[0] });
        expect(resolveNewSessionMachine(machines, 'online-b')?.machine?.id).toBe('online-b');
        // A removed daemon stays selected instead of silently rerouting.
        expect(resolveNewSessionMachine(machines, 'gone')).toEqual({ id: 'gone', machine: null });
        expect(resolveNewSessionMachine([], null)).toBeNull();
    });

    it('lists online machines first and keeps each group in store order', () => {
        const machines = [machine('a', false), machine('b', true), machine('c', false), machine('d', true)];
        expect(orderMachinesForMenu(machines).map((m) => m.id)).toEqual(['b', 'd', 'a', 'c']);
    });
});

describe('session row presentation', () => {
    it('adds a status line only while the session waits on the user', () => {
        expect(resolveHerdRowAttention('permission_required')).toBe('status.permissionRequired');
        expect(resolveHerdRowAttention('input_required')).toBe('status.inputRequired');
        expect(resolveHerdRowAttention('thinking')).toBeNull();
        expect(resolveHerdRowAttention('waiting')).toBeNull();
        expect(resolveHerdRowAttention('disconnected')).toBeNull();
    });

    it('names the agent from the catalog and features Claude and Codex', () => {
        const row = (overrides: Record<string, unknown>) => ({ botId: null, flavor: null, providerKind: null, identityLine: null, ...overrides }) as any;
        expect(resolveHerdRowAgentLabel(row({ flavor: 'claude' }))).toEqual({ label: 'Claude', featured: true });
        expect(resolveHerdRowAgentLabel(row({ flavor: 'codex' }))).toEqual({ label: 'Codex', featured: true });
        expect(resolveHerdRowAgentLabel(row({ providerKind: 'grok' }))).toEqual({ label: 'GrokBuild', featured: false });
        expect(resolveHerdRowAgentLabel(row({ flavor: 'rig', identityLine: 'Cursor · Anthropic' }))).toEqual({ label: 'Anthropic', featured: false });
        expect(resolveHerdRowAgentLabel(row({ flavor: 'custom-agent' }))).toEqual({ label: 'custom-agent', featured: false });
        expect(resolveHerdRowAgentLabel(row({ botId: 'bot-1', flavor: 'claude' }))).toBeNull();
        expect(resolveHerdRowAgentLabel(row({}))).toBeNull();
    });
});

describe('window insets for fullscreen content', () => {
    const insets = (top: number) => ({ top, right: 0, bottom: 34, left: 0 });
    function probe(tree: (child: React.ReactElement) => React.ReactElement) {
        let seen: { top: number } | null = null;
        function Probe() {
            seen = useWindowSafeAreaInsets();
            return null;
        }
        act(() => { create(tree(React.createElement(Probe))); });
        return seen!;
    }

    it('keeps the real top inset inside the shell body, where screens see zero', () => {
        const seen = probe((child) => React.createElement(HerdWindowInsetsContext.Provider, { value: insets(24) },
            React.createElement(SafeAreaInsetsContext.Provider, { value: insets(0) }, child)));
        expect(seen.top).toBe(24);
    });

    it('falls back to the local insets outside the desktop shell', () => {
        const seen = probe((child) => React.createElement(SafeAreaInsetsContext.Provider, { value: insets(11) }, child));
        expect(seen.top).toBe(11);
    });
});
