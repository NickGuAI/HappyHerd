import * as React from 'react';
import { TextInput } from 'react-native';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    window: { width: 390, height: 844 },
    platform: 'web',
    tablet: false,
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
        Platform: {
            get OS() { return mocks.platform; },
            select: (options: Record<string, unknown>) => options[mocks.platform] ?? options.default,
        },
        View: 'View',
        Text: 'Text',
        Pressable: 'Pressable',
        Modal: 'Modal',
        ScrollView: 'ScrollView',
        TextInput: 'TextInput',
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
vi.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView' }));
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
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => mocks.tablet }));
vi.mock('@/components/MobileGlass', () => ({ MobileGlassSurface: 'MobileGlassSurface' }));
vi.mock('@/components/AnimatedOverlay', () => ({ AnimatedPopup: 'AnimatedPopup', LocalBlurHalo: () => null }));
vi.mock('@/hooks/useSessionQuickActions', () => ({ useSessionQuickActions: () => ({ actionItems: mocks.actions }) }));
vi.mock('@/sync/storage', () => ({ useSession: (id: string) => ({ id, metadata: { summary: { text: 'Refresh token rotation' } } }) }));
vi.mock('@/utils/sessionUtils', () => ({ getSessionName: (session: any) => session.metadata.summary.text }));

import { HerdMenuItem, HerdMenuSeparator, HerdMenuTitle, HerdPopover } from '../HerdPopover';
import { SessionActionsPopover } from '../../SessionActionsPopover';
import { HERD_SHEET_DISMISS_DISTANCE, HERD_SHEET_DISMISS_VELOCITY, HerdBottomSheet, shouldDismissHerdSheet } from './HerdBottomSheet';
import { HERD_PHONE_SHEET_MAX_WIDTH, isHerdPhoneLayout, isHerdPhoneWeb } from './useHerdPhone';
import { calculateDeviceDimensions, determineDeviceType } from '@/utils/deviceCalculations';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    mocks.window = { width: 390, height: 844 };
    mocks.platform = 'web';
    mocks.tablet = false;
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

    it('lays the web out by width, though the device rule calls a 1024 × 768 window a phone, and keeps the device rule in the apps', () => {
        const deviceRule = (width: number, height: number) => determineDeviceType({
            diagonalInches: calculateDeviceDimensions({ widthPoints: width, heightPoints: height, pointsPerInch: 160 }).diagonalInches,
            platform: 'web',
        });
        expect(deviceRule(1024, 768)).toBe('phone');
        expect(isHerdPhoneLayout({ platform: 'web', width: 1024, isTablet: false })).toBe(false);
        expect(isHerdPhoneLayout({ platform: 'web', width: HERD_PHONE_SHEET_MAX_WIDTH, isTablet: false })).toBe(false);
        expect(isHerdPhoneLayout({ platform: 'web', width: HERD_PHONE_SHEET_MAX_WIDTH - 1, isTablet: true })).toBe(true);
        // A phone stays a phone in landscape; a tablet stays a tablet at any width.
        expect(isHerdPhoneLayout({ platform: 'ios', width: 844, isTablet: false })).toBe(true);
        expect(isHerdPhoneLayout({ platform: 'android', width: 600, isTablet: true })).toBe(false);
    });
});

describe('HerdPopover on a phone', () => {
    const anchor = { x: 280, y: 100, width: 90, height: 32 };
    const popover = (onClose: () => void, onPick: () => void, width = 280) => React.createElement(HerdPopover, {
        visible: true,
        anchor,
        onClose,
        width,
        accessibilityLabel: 'Machines',
        testID: 'probe-popover',
        children: [
            React.createElement(HerdMenuTitle, { key: 'title', children: 'Machines' }),
            React.createElement(HerdMenuItem, { key: 'item', label: 'build-box', hint: 'linux · online', onPress: onPick, testID: 'probe-item' }),
        ],
    });

    it('stays anchored on Web Mobile, 8 px from the window edge, with touch-size rows on the gutter', () => {
        const onClose = vi.fn();
        const renderer = render(popover(onClose, vi.fn()));
        const [card] = byTestID(renderer, 'probe-popover');
        expect(card.props.accessibilityRole).toBe('menu');
        expect(card.props.accessibilityLabel).toBe('Machines');
        // Aligned to the trigger's end edge, 8 px below it.
        expect(flatStyle(card.props.style)).toMatchObject({ left: 90, top: 140, width: 280, padding: 8 });
        expect(byTestID(renderer, 'probe-popover-handle')).toEqual([]);
        const [item] = byTestID(renderer, 'probe-item');
        expect(pressableStyle(item)).toMatchObject({ minHeight: 48, paddingHorizontal: 8 });
        // Every item keeps its label and hint.
        expect(item.findAll((node: any) => node.type === 'Text').map((node: any) => node.props.children)).toEqual(['build-box', 'linux · online']);
        byTestID(renderer, 'probe-popover-backdrop')[0].props.onPress();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('never grows past the phone window less 8 px a side', () => {
        const renderer = render(popover(vi.fn(), vi.fn(), 380));
        expect(flatStyle(byTestID(renderer, 'probe-popover')[0].props.style)).toMatchObject({ left: 8, width: 374 });
    });

    it('presents its content as a labelled bottom sheet with touch-size rows on a native phone', () => {
        mocks.platform = 'ios';
        const onClose = vi.fn();
        const renderer = render(popover(onClose, vi.fn()));
        const [sheet] = byTestID(renderer, 'probe-popover');
        expect(sheet.type).toBe('View');
        expect(sheet.props.role).toBe('menu');
        expect(sheet.props['aria-label']).toBe('Machines');
        // The sheet fades on native; it clears the home indicator.
        expect(renderer.root.findByType('Modal').props.animationType).toBe('fade');
        expect(flatStyle(sheet.props.style).paddingBottom).toBe(42);
        const [handle] = byTestID(renderer, 'probe-popover-handle');
        expect(handle.props.accessibilityLabel).toBe('common.cancel');
        expect(pressableStyle(byTestID(renderer, 'probe-item')[0])).toMatchObject({ minHeight: 48, paddingHorizontal: 8 });
        byTestID(renderer, 'probe-popover-backdrop')[0].props.onPress();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the anchored card on a native tablet and at desktop width', () => {
        mocks.platform = 'ios';
        mocks.tablet = true;
        expect(byTestID(render(popover(vi.fn(), vi.fn())), 'probe-popover-handle')).toEqual([]);
        mocks.platform = 'web';
        mocks.window = { width: 1440, height: 900 };
        const renderer = render(popover(vi.fn(), vi.fn()));
        const [card] = byTestID(renderer, 'probe-popover');
        expect(card.props.accessibilityRole).toBe('menu');
        expect(flatStyle(card.props.style)).toMatchObject({ width: 280, padding: 6 });
        expect(byTestID(renderer, 'probe-popover-handle')).toEqual([]);
        expect(pressableStyle(byTestID(renderer, 'probe-item')[0]).minHeight).not.toBe(48);
    });
});

describe('HerdBottomSheet', () => {
    it('closes from a handle tap but not from the click that ends a drag', () => {
        const onClose = vi.fn();
        const renderer = render(React.createElement(HerdBottomSheet, {
            visible: true,
            onClose,
            testID: 'probe-sheet',
            children: React.createElement(HerdMenuItem, { label: 'build-box', onPress: vi.fn() }),
        }));
        const handle = () => byTestID(renderer, 'probe-sheet-handle')[0];
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

    // A picker searched down to one result.
    const searchedSheet = () => React.createElement(HerdBottomSheet, {
        visible: true,
        onClose: vi.fn(),
        testID: 'probe-sheet',
        children: [
            React.createElement(TextInput, { key: 'search', testID: 'probe-search', value: 'opus' }),
            React.createElement(HerdMenuItem, { key: 'result', label: 'claude-opus-5-5', onPress: vi.fn(), testID: 'probe-result' }),
        ],
    });

    it('rises above the keyboard with its Search field on a native phone', () => {
        mocks.platform = 'ios';
        const renderer = render(searchedSheet());
        // The keyboard-aware container fills the Modal, below the status bar, and
        // holds the scrim and the sheet with its field and result at its bottom.
        const [keyboard] = renderer.root.findByType('Modal').findAllByType('KeyboardAvoidingView');
        expect(keyboard?.props.behavior).toBe('padding');
        expect(flatStyle(keyboard.props.style)).toMatchObject({ flex: 1, justifyContent: 'flex-end', paddingTop: 47 });
        for (const testID of ['probe-sheet-backdrop', 'probe-sheet', 'probe-search', 'probe-result']) {
            expect(keyboard.findAll((node: any) => typeof node.type === 'string' && node.props.testID === testID)).toHaveLength(1);
        }
        // A sheet taller than the room above the keyboard shrinks, and its body scrolls.
        const [sheet] = byTestID(renderer, 'probe-sheet');
        expect(flatStyle(sheet.props.style).flexShrink).toBe(1);
        expect(flatStyle(sheet.parent.props.style).flexShrink).toBe(1);

        mocks.platform = 'android';
        expect(render(searchedSheet()).root.findByType('KeyboardAvoidingView').props.behavior).toBe('height');
    });

    it('keeps the web sheet out of the keyboard container', () => {
        const renderer = render(searchedSheet());
        expect(renderer.root.findAllByType('KeyboardAvoidingView')).toEqual([]);
        const [backdrop] = byTestID(renderer, 'probe-sheet-backdrop');
        expect(backdrop.parent.type).toBe('View');
        expect(flatStyle(backdrop.parent.props.style)).toEqual({ flex: 1, justifyContent: 'flex-end' });
        expect(renderer.root.findByType('Modal').props.animationType).toBe('none');
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
    const popover = (onClose: () => void, anchor: any = { type: 'point', x: 120, y: 300 }) => React.createElement(SessionActionsPopover, {
        anchor,
        onClose,
        sessionId: 'auth',
        visible: true,
    });
    const menuFrame = (renderer: any) => flatStyle(byTestID(renderer, 'session-actions-menu')[0].parent.props.style);

    it('opens the anchored card on Web Mobile, titled with the session, with every action', () => {
        const onClose = vi.fn();
        const renderer = render(popover(onClose));
        const [card] = byTestID(renderer, 'session-actions-menu');
        expect(flatStyle(card.props.style).padding).toBe(8);
        // The phone card is as wide as the window allows, up to 330 px, and kept 8 px inside it.
        expect(menuFrame(renderer)).toMatchObject({ left: 52, top: 300, width: 330 });
        // A phone has no keyboard for the chords, so the card shows no shortcut hints.
        const texts = card.findAll((node: any) => node.type === 'Text').map((node: any) => node.props.children);
        expect(texts).toEqual(['Refresh token rotation', 'Details', 'Fork session', 'Archive']);

        // A separator sets the destructive action apart, as in the mock.
        const archive = card.findAll((node: any) => node.type === 'Pressable' && node.findAll((child: any) => child.props.children === 'Archive').length > 0)[0];
        const siblings = archive.parent.children;
        expect(siblings[siblings.indexOf(archive) - 1].type).toBe(HerdMenuSeparator);

        const details = card.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityRole === 'button'
            && node.findAll((child: any) => child.props.children === 'Details').length > 0)[0];
        expect(pressableStyle(details)).toMatchObject({ minHeight: 48, paddingHorizontal: 8 });
        act(() => details.props.onPress());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onPress.details).toHaveBeenCalledTimes(1);
    });

    it('opens below a header trigger and inside the narrowest phone', () => {
        mocks.window = { width: 320, height: 640 };
        const renderer = render(popover(vi.fn(), { type: 'rect', x: 270, y: 60, width: 44, height: 44 }));
        expect(menuFrame(renderer)).toMatchObject({ left: 8, top: 112, width: 304 });
    });

    it('keeps the card, rim included, 8 px inside a short window, and never taller than it allows', () => {
        mocks.window = { width: 568, height: 320 };
        const renderer = render(popover(vi.fn(), { type: 'point', x: 284, y: 219 }));
        // The title, three rows, the separator, the padding and the 1 px rim end 8 px above the bottom edge.
        expect(menuFrame(renderer)).toMatchObject({ left: 230, top: 109 });
        expect(flatStyle(byTestID(renderer, 'session-actions-menu')[0].props.style).maxHeight).toBe(304);
    });

    it('keeps the anchored web card at desktop width', () => {
        mocks.window = { width: 1440, height: 900 };
        const renderer = render(popover(vi.fn()));
        const modal = renderer.root.findByType('Modal');
        expect(modal.findAll((node: any) => node.props.children === 'Details')).toHaveLength(1);
        expect(modal.findAll((node: any) => node.type === 'Text' && node.props.children === 'Refresh token rotation')).toEqual([]);
        expect(menuFrame(renderer).width).toBe(288);
        expect(modal.findAll((node: any) => node.type === 'Text' && node.props.children === 'Ctrl+Alt+O')).toHaveLength(1);
    });
});
