import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    machines: [] as any[],
    ready: true,
    focus: null as null | { projectId: string; endsAt: number; startedAt: number },
    push: vi.fn(),
    setFocusMode: vi.fn(),
    hovered: false,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
        View: host('View'),
        Text: host('Text'),
        ScrollView: host('ScrollView'),
        Modal: host('Modal'),
        // Renders function children the way React Native's Pressable does.
        Pressable: (props: any) => ReactModule.createElement('Pressable', props,
            typeof props.children === 'function' ? props.children({ pressed: false, hovered: state.hovered }) : props.children),
        Animated: { Value: class { interpolate() { return this; } }, View: host('AnimatedView'), timing: () => ({ start() {}, stop() {} }) },
        Easing: { bezier: () => () => 0 },
        useWindowDimensions: () => ({ width: 1440, height: 900 }),
    };
});
vi.mock('react-native-svg', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { default: host('Svg'), Circle: host('Circle') };
});
vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('react-native-unistyles', () => {
    const theme = new Proxy({}, { get: (_target, key) => (key === 'dark' ? true : typeof key === 'string' ? theme : undefined) });
    return {
        StyleSheet: { create: (factory: any) => (typeof factory === 'function' ? factory(theme) : factory) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}), header: () => ({}), logo: () => ({}) } }));
vi.mock('@/hooks/useNewSessionDraft', () => ({
    useNewSessionDraft: (select: (draft: unknown) => unknown) => select({ selectedMachineId: null, setMachineId: vi.fn() }),
}));
vi.mock('@/hooks/useFocusMode', () => ({ useFocusMode: () => state.focus }));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => state.machines,
    useSessionListViewData: () => (state.ready ? [] : null),
    useProjects: () => ({ alpha: { id: 'alpha', name: 'Alpha', kind: 'personal' } }),
    useSettingMutable: () => [null, state.setFocusMode],
}));
vi.mock('@/text', () => ({ t: (key: string, params?: Record<string, string>) => (params?.time ? `${key}:${params.time}` : key) }));
vi.mock('@/components/herd/shell/HerdShellIcon', async () => {
    const ReactModule = await import('react');
    return { HerdShellIcon: (props: any) => ReactModule.createElement('HerdShellIcon', props) };
});
vi.mock('@/components/herd/HerdPopover', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        HerdPopover: (props: any) => (props.visible ? ReactModule.createElement('HerdPopover', props, props.children) : null),
        HerdMenuTitle: host('HerdMenuTitle'),
        HerdMenuSeparator: host('HerdMenuSeparator'),
        HerdMenuItem: host('HerdMenuItem'),
        measureHerdAnchor: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
    };
});
vi.mock('@/components/herd/shell/HerdTooltip', async () => {
    const ReactModule = await import('react');
    return { HerdTooltip: (props: any) => ReactModule.createElement('HerdTooltip', props) };
});
vi.mock('@/components/herd/SegmentedControl', () => ({ HerdSegmentedControl: 'HerdSegmentedControl' }));
vi.mock('@/components/herd/pages/HerdSheet', () => ({ useSheetEscapeKeydown: () => {} }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => false }));
vi.mock('@/components/herd/pages/HerdPage', () => ({ HerdButton: 'HerdButton', HerdChip: 'HerdChip', HerdSectionLabel: 'HerdSectionLabel' }));

import { FocusModeControl, openFocusSetup } from '@/components/FocusModeControl';
import { closeFocusSetup } from '@/components/focusSetup';
import { HerdMachineMenu, resolveMachinePillState } from './HerdMachineMenu';
import { HerdTopBarIconButton } from './HerdTopBarIconButton';
import { HerdTopBarLayoutContext } from './topBarLayout';

const renderers: ReactTestRenderer[] = [];

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(state, { machines: [], ready: true, focus: null, hovered: false });
    state.push.mockClear();
    state.setFocusMode.mockClear();
    act(() => closeFocusSetup());
});

function render(element: React.ReactElement, layout: 'desktop' | 'phone' = 'desktop') {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(HerdTopBarLayoutContext.Provider, { value: layout }, element));
    });
    renderers.push(renderer);
    return renderer;
}

const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType('Text' as any).map((node: any) => [node.props.children].flat().join(''));
const icons = (renderer: ReactTestRenderer) => renderer.root.findAllByType('HerdShellIcon' as any).map((node: any) => node.props.name);
const machine = (id: string, active: boolean) => ({ id, active, metadata: { host: id, platform: 'darwin' } });

describe('top bar machine pill, always visible', () => {
    it('resolves loading, empty and machine states', () => {
        expect(resolveMachinePillState({ ready: false, machineCount: 0, hasCurrent: false })).toBe('loading');
        expect(resolveMachinePillState({ ready: true, machineCount: 0, hasCurrent: false })).toBe('empty');
        // A draft that still remembers a machine on an account that has none reads as empty.
        expect(resolveMachinePillState({ ready: true, machineCount: 0, hasCurrent: true })).toBe('empty');
        expect(resolveMachinePillState({ ready: true, machineCount: 2, hasCurrent: true })).toBe('machine');
    });

    it('shows a busy pill while machines load', () => {
        state.ready = false;
        const renderer = render(React.createElement(HerdMachineMenu, {}));
        const trigger = renderer.root.findByProps({ testID: 'herd-machine-menu' });
        expect(trigger.props.disabled).toBe(true);
        expect(trigger.props['aria-busy']).toBe(true);
        expect(renderer.root.findAllByProps({ testID: 'herd-machine-pill-loading' }).length).toBeGreaterThan(0);
        expect(texts(renderer)).toContain('common.loading');
    });

    it('shows "No machine" when the account has none, with a menu that adds one in Connections', async () => {
        const renderer = render(React.createElement(HerdMachineMenu, {}));
        expect(renderer.root.findAllByProps({ testID: 'herd-machine-pill-empty' }).length).toBeGreaterThan(0);
        expect(texts(renderer)).toContain('topBar.noMachine');
        expect(icons(renderer)).toEqual(['monitor', 'chevronDown']);
        await act(async () => renderer.root.findByProps({ testID: 'herd-machine-menu' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'herd-machine-empty' }).props.children).toBe('topBar.noMachinesYet');
        const add = renderer.root.findByProps({ testID: 'herd-machine-connections' });
        expect(add.props.label).toBe('topBar.addMachine');
        act(() => add.props.onPress());
        expect(state.push).toHaveBeenCalledWith('/settings/connections');
    });

    it('shows the current machine and whether it is online, with Connections and details in its menu', async () => {
        state.machines = [machine('studio-mac', true), machine('gpu-lab', false)];
        const renderer = render(React.createElement(HerdMachineMenu, {}));
        expect(texts(renderer)).toEqual(expect.arrayContaining(['studio-mac', 'status.online']));
        expect(icons(renderer)).toEqual(['monitor', 'chevronDown']);
        await act(async () => renderer.root.findByProps({ testID: 'herd-machine-menu' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'herd-machine-connections' }).props.label).toBe('devicePairing.title');
        expect(renderer.root.findAllByType('HerdMenuItem' as any).filter((node: any) => node.props.label === 'sessionInfo.viewMachine')).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'herd-machine-option-gpu-lab' })[0].props.disabled).toBe(true);
    });

    it('draws the phone mock pill: the status dot and name, no status word or monitor icon', () => {
        state.machines = [machine('studio-mac', true)];
        const renderer = render(React.createElement(HerdMachineMenu, {}), 'phone');
        expect(texts(renderer)).toContain('studio-mac');
        expect(texts(renderer)).not.toContain('status.online');
        expect(icons(renderer)).toEqual(['chevronDown']);
    });
});

describe('top bar Focus mode control', () => {
    it('is a "Focus mode" pill with the focus icon on the desktop, not the tomato', () => {
        const renderer = render(React.createElement(FocusModeControl));
        const enter = renderer.root.findByProps({ testID: 'focus-mode-enter' });
        expect(enter.props.accessibilityLabel).toBe('focusMode.enter');
        expect(texts(renderer)).toContain('focusMode.enter');
        expect(icons(renderer)).toEqual(['focus']);
    });

    it('is an icon button on phones', () => {
        const renderer = render(React.createElement(FocusModeControl), 'phone');
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-enter' }).length).toBeGreaterThan(0);
        expect(texts(renderer)).not.toContain('focusMode.enter');
        expect(icons(renderer)).toEqual(['focus']);
    });

    it('shows the desktop countdown with its project and an exit', () => {
        const now = Date.now();
        state.focus = { projectId: 'alpha', startedAt: now, endsAt: now + 15 * 60_000 };
        const renderer = render(React.createElement(FocusModeControl));
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-pill' }).length).toBeGreaterThan(0);
        expect(texts(renderer)).toEqual(expect.arrayContaining(['15:00', 'Alpha']));
        act(() => renderer.root.findByProps({ testID: 'focus-mode-exit' }).props.onPress());
        expect(state.setFocusMode).toHaveBeenCalledWith(null);
    });

    it('opens a menu with the project, the time left and Exit from the phone countdown', async () => {
        const now = Date.now();
        state.focus = { projectId: 'alpha', startedAt: now, endsAt: now + 30 * 60_000 };
        const renderer = render(React.createElement(FocusModeControl), 'phone');
        expect(texts(renderer)).not.toContain('Alpha');
        const pill = renderer.root.findAllByProps({ testID: 'focus-mode-pill' }).find((node: any) => node.props.onPress);
        expect(pill.props['aria-haspopup']).toBe('menu');
        await act(async () => pill.props.onPress());
        expect(texts(renderer)).toEqual(expect.arrayContaining(['Alpha']));
        const exit = renderer.root.findByProps({ testID: 'focus-mode-exit' });
        act(() => exit.props.onPress());
        expect(state.setFocusMode).toHaveBeenCalledWith(null);
    });
});

describe('Focus setup dialog', () => {
    const startButton = (renderer: ReactTestRenderer) => renderer.root.findAllByType('HerdButton' as any)
        .find((node: any) => node.props.label === 'focusMode.start');

    it('opens from the top bar as the mock dialog: the glyph in a ring, then the title inside the card', () => {
        const renderer = render(React.createElement(FocusModeControl));
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-setup' })).toHaveLength(0);
        act(() => renderer.root.findByProps({ testID: 'focus-mode-enter' }).props.onPress());
        const card = renderer.root.findByProps({ testID: 'focus-mode-setup' });
        expect(card.props.role).toBe('dialog');
        expect(card.findByProps({ testID: 'focus-mode-mark' }).findByType('HerdShellIcon' as any).props.name).toBe('focus');
        const title = card.findAll((node: any) => node.type === 'Text' && node.props.accessibilityRole === 'header');
        expect(title.map((node: any) => node.props.children)).toEqual(['focusMode.title']);
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-pixel-swap' })).toHaveLength(0);
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-scrim' }).length).toBeGreaterThan(0);
    });

    it('opens preset to a project through openFocusSetup and starts focus on it', () => {
        const renderer = render(React.createElement(FocusModeControl));
        act(() => openFocusSetup({ projectId: 'alpha' }));
        const alpha = renderer.root.findAllByType('HerdChip' as any).find((node: any) => node.props.label === 'Alpha');
        expect(alpha.props.selected).toBe(true);
        expect(startButton(renderer).props.disabled).toBe(false);
        const before = Date.now();
        act(() => startButton(renderer).props.onPress());
        const written = state.setFocusMode.mock.calls[0][0];
        expect(written.projectId).toBe('alpha');
        expect(written.endsAt - written.startedAt).toBe(30 * 60_000);
        expect(written.startedAt).toBeGreaterThanOrEqual(before);
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-setup' })).toHaveLength(0);
    });

    it('waits for a project when opened without one, and dismisses from the scrim', () => {
        const renderer = render(React.createElement(FocusModeControl));
        act(() => openFocusSetup());
        expect(startButton(renderer).props.disabled).toBe(true);
        expect(texts(renderer)).toContain('focusMode.selectProject');
        act(() => renderer.root.findAllByProps({ testID: 'focus-mode-scrim' })[0].props.onPress());
        expect(renderer.root.findAllByProps({ testID: 'focus-mode-setup' })).toHaveLength(0);
        expect(state.setFocusMode).not.toHaveBeenCalled();
    });
});

describe('top bar icon button tooltip', () => {
    const button = () => React.createElement(HerdTopBarIconButton, {
        label: 'Collapse navigation sidebar', hint: '⌥⌘B', onPress: vi.fn(), tooltipAlign: 'start', children: null,
    });

    it('shows the mock tooltip with the shortcut on hover, never a native title', () => {
        expect(render(button()).root.findAllByType('HerdTooltip' as any)).toHaveLength(0);
        state.hovered = true;
        const renderer = render(button());
        expect(renderer.root.findByType('HerdTooltip' as any).props).toMatchObject({ label: 'Collapse navigation sidebar', hint: '⌥⌘B', align: 'start' });
        const pressable = renderer.root.findByType('Pressable' as any);
        expect(pressable.props.ref).toBeUndefined();
        expect(pressable.props.accessibilityLabel).toBe('Collapse navigation sidebar');
    });

    it('has no hover tooltip in the phone top bar', () => {
        state.hovered = true;
        expect(render(button(), 'phone').root.findAllByType('HerdTooltip' as any)).toHaveLength(0);
    });
});
