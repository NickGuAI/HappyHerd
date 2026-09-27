import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    window: { width: 390, height: 844 },
    panConfig: null as any,
    actions: [] as Array<{ id: string; icon: string; label: string; onPress: () => void; destructive?: boolean }>,
}));

vi.mock('react-native', () => {
    class Value {
        value: number;
        constructor(value: number) { this.value = value; }
        setValue(value: number) { this.value = value; }
    }
    return {
        Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
        View: 'View',
        Text: 'Text',
        Pressable: 'Pressable',
        Modal: 'Modal',
        ScrollView: 'ScrollView',
        Animated: { View: 'AnimatedView', Value, spring: () => ({ start() {} }) },
        PanResponder: {
            create: (config: unknown) => {
                mocks.panConfig = config;
                return { panHandlers: {} };
            },
        },
        useWindowDimensions: () => mocks.window,
    };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }) }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('react-native-unistyles', () => {
    const theme: any = new Proxy({}, { get: () => theme });
    return {
        StyleSheet: { create: (factory: any) => (typeof factory === 'function' ? factory(theme) : factory) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/components/MobileGlass', () => ({ MobileGlassSurface: 'MobileGlassSurface' }));
vi.mock('@/components/AnimatedOverlay', () => ({ AnimatedPopup: 'AnimatedPopup', LocalBlurHalo: () => null }));
vi.mock('@/hooks/useSessionQuickActions', () => ({ useSessionQuickActions: () => ({ actionItems: mocks.actions }) }));
vi.mock('@/sync/storage', () => ({ useSession: (id: string) => ({ id, metadata: { summary: { text: 'Refresh token rotation' } } }) }));
vi.mock('@/utils/sessionUtils', () => ({ getSessionName: (session: any) => session.metadata.summary.text }));

import { HerdMenuItem, HerdPopover } from '../HerdPopover';
import { SessionActionsPopover } from '../../SessionActionsPopover';
import { HERD_SHEET_DISMISS_DISTANCE, HERD_SHEET_DISMISS_VELOCITY, shouldDismissHerdSheet } from './HerdBottomSheet';
import { HERD_PHONE_SHEET_MAX_WIDTH, isHerdPhoneWeb } from './useHerdPhone';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    mocks.window = { width: 390, height: 844 };
    mocks.panConfig = null;
});

function render(element: React.ReactElement) {
    let renderer: any;
    act(() => {
        renderer = create(element);
    });
    return renderer;
}

const byTestID = (renderer: any, testID: string) => renderer.root.findAll((node: any) => typeof node.type === 'string' && node.props.testID === testID);
const flatStyle = (style: any): Record<string, unknown> => Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
    : (style ?? {});
const pressableStyle = (node: any) => flatStyle(typeof node.props.style === 'function' ? node.props.style({ pressed: false, hovered: false }) : node.props.style);

describe('phone sheet dismissal', () => {
    it('dismisses past the drag distance or on a fast downward flick, never on an upward drag', () => {
        expect(shouldDismissHerdSheet(HERD_SHEET_DISMISS_DISTANCE + 1, 0)).toBe(true);
        expect(shouldDismissHerdSheet(HERD_SHEET_DISMISS_DISTANCE, 0)).toBe(false);
        expect(shouldDismissHerdSheet(20, HERD_SHEET_DISMISS_VELOCITY + 0.1)).toBe(true);
        expect(shouldDismissHerdSheet(20, 0.3)).toBe(false);
        expect(shouldDismissHerdSheet(-120, -2)).toBe(false);
    });

    it('treats Web windows narrower than 700 px as phones', () => {
        expect(isHerdPhoneWeb(390)).toBe(true);
        expect(isHerdPhoneWeb(HERD_PHONE_SHEET_MAX_WIDTH - 1)).toBe(true);
        expect(isHerdPhoneWeb(HERD_PHONE_SHEET_MAX_WIDTH)).toBe(false);
        expect(isHerdPhoneWeb(1440)).toBe(false);
    });
});

describe('HerdPopover on a phone', () => {
    const anchor = { x: 280, y: 100, width: 90, height: 32 };
    const popover = (onClose: () => void, onPick: () => void) => React.createElement(HerdPopover, {
        visible: true,
        anchor,
        onClose,
        width: 280,
        accessibilityLabel: 'Machines',
        testID: 'probe-popover',
        children: React.createElement(HerdMenuItem, { label: 'build-box', hint: 'linux · online', onPress: onPick, testID: 'probe-item' }),
    });

    it('presents its content as a labelled bottom sheet with touch-size rows', () => {
        const onClose = vi.fn();
        const renderer = render(popover(onClose, vi.fn()));
        const [sheet] = byTestID(renderer, 'probe-popover');
        expect(sheet.type).toBe('View');
        expect(sheet.props.role).toBe('menu');
        expect(sheet.props['aria-label']).toBe('Machines');
        const [handle] = byTestID(renderer, 'probe-popover-handle');
        expect(handle.props.accessibilityLabel).toBe('common.cancel');
        const [item] = byTestID(renderer, 'probe-item');
        expect(pressableStyle(item).minHeight).toBe(48);
        // Every item keeps its label and hint.
        expect(item.findAll((node: any) => node.type === 'Text').map((node: any) => node.props.children)).toEqual(['build-box', 'linux · online']);
        byTestID(renderer, 'probe-popover-backdrop')[0].props.onPress();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes from a handle tap but not from the click that ends a drag', () => {
        const onClose = vi.fn();
        const renderer = render(popover(onClose, vi.fn()));
        const handle = () => byTestID(renderer, 'probe-popover-handle')[0];
        // The web handle claims the gesture on press, so a fast flick still drags.
        expect(mocks.panConfig.onStartShouldSetPanResponderCapture()).toBe(true);

        mocks.panConfig.onPanResponderGrant();
        mocks.panConfig.onPanResponderMove(null, { dy: 30, dx: 0 });
        mocks.panConfig.onPanResponderRelease(null, { dy: 30, vy: 0.1 });
        handle().props.onPress();
        expect(onClose).not.toHaveBeenCalled();

        mocks.panConfig.onPanResponderGrant();
        mocks.panConfig.onPanResponderRelease(null, { dy: 0, vy: 0 });
        handle().props.onPress();
        expect(onClose).toHaveBeenCalledTimes(1);

        mocks.panConfig.onPanResponderGrant();
        mocks.panConfig.onPanResponderMove(null, { dy: 120, dx: 0 });
        mocks.panConfig.onPanResponderRelease(null, { dy: 120, vy: 0.2 });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('stays an anchored card at desktop width', () => {
        mocks.window = { width: 1440, height: 900 };
        const renderer = render(popover(vi.fn(), vi.fn()));
        const [card] = byTestID(renderer, 'probe-popover');
        expect(card.props.accessibilityRole).toBe('menu');
        expect(flatStyle(card.props.style).width).toBe(280);
        expect(byTestID(renderer, 'probe-popover-handle')).toEqual([]);
        expect(pressableStyle(byTestID(renderer, 'probe-item')[0]).minHeight).not.toBe(48);
    });
});

describe('session actions on a phone', () => {
    const onPress = vi.hoisted(() => ({ details: vi.fn(), archive: vi.fn() }));
    beforeEach(() => {
        mocks.actions = [
            { id: 'details', icon: 'information-circle-outline', label: 'Details', onPress: onPress.details },
            { id: 'fork', icon: 'git-branch-outline', label: 'Fork session', onPress: vi.fn() },
            { id: 'archive', icon: 'archive-outline', label: 'Archive', onPress: onPress.archive, destructive: true },
        ];
    });
    const popover = (onClose: () => void) => React.createElement(SessionActionsPopover, {
        anchor: { type: 'point', x: 120, y: 300 },
        onClose,
        sessionId: 'auth',
        visible: true,
    });

    it('opens a bottom sheet titled with the session, keeping every action and shortcut', () => {
        const onClose = vi.fn();
        const renderer = render(popover(onClose));
        const [sheet] = byTestID(renderer, 'session-actions-sheet');
        expect(sheet.props.role).toBe('dialog');
        expect(sheet.props['aria-label']).toBe('Refresh token rotation');
        const texts = sheet.findAll((node: any) => node.type === 'Text').map((node: any) => node.props.children);
        expect(texts).toEqual(['Refresh token rotation', 'Details', 'Ctrl+Alt+O', 'Fork session', 'Ctrl+Alt+F', 'Archive', 'Ctrl+Shift+A']);

        // A separator sets the destructive action apart, as in the mock.
        const body = sheet.findByType('ScrollView');
        const children = body.children.flatMap((child: any) => child.type === React.Fragment ? child.children : [child]);
        const archiveIndex = children.findIndex((child: any) => child.findAll?.((node: any) => node.props.children === 'Archive').length);
        expect(archiveIndex).toBeGreaterThan(1);
        expect(children[archiveIndex - 1].findAll((node: any) => node.type === 'Pressable')).toEqual([]);

        const details = sheet.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityRole === 'button'
            && node.findAll((child: any) => child.props.children === 'Details').length > 0)[0];
        expect(pressableStyle(details).minHeight).toBe(48);
        act(() => details.props.onPress());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onPress.details).toHaveBeenCalledTimes(1);
    });

    it('keeps the anchored web card at desktop width', () => {
        mocks.window = { width: 1440, height: 900 };
        const renderer = render(popover(vi.fn()));
        expect(byTestID(renderer, 'session-actions-sheet')).toEqual([]);
        const modal = renderer.root.findByType('Modal');
        expect(modal.findAll((node: any) => node.props.children === 'Details')).toHaveLength(1);
        expect(modal.findAll((node: any) => node.type === 'Text' && node.props.children === 'Refresh token rotation')).toEqual([]);
    });
});
