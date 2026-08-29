import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    platform: 'web' as 'web' | 'android' | 'ios',
    width: 1280,
    height: 800,
    anchor: { x: 980, y: 700, width: 32, height: 32 },
    safeBottom: 0,
    dark: false,
    focus: vi.fn(),
    keydown: null as ((event: KeyboardEvent) => void) | null,
    lightTheme: {
        dark: false,
        colors: {
            text: '#111111',
            textSecondary: '#666666',
            surfaceSelected: '#eeeeee',
            divider: '#dddddd',
            header: { background: '#ffffff' },
            glass: {
                backgroundStrong: 'rgba(255, 255, 255, 0.84)',
                border: 'rgba(255, 255, 255, 0.82)',
                overlayTint: 'rgba(255, 255, 255, 0.46)',
                shadow: 'rgba(39, 47, 54, 0.16)',
            },
        },
    },
    darkTheme: {
        dark: true,
        colors: {
            text: '#ffffff',
            textSecondary: '#aaaaaa',
            surfaceSelected: '#2c2c2e',
            divider: '#292929',
            header: { background: '#212121' },
            glass: {
                backgroundStrong: 'rgba(28, 28, 28, 0.68)',
                border: 'rgba(255, 255, 255, 0.14)',
                overlayTint: 'rgba(0, 0, 0, 0.56)',
                shadow: 'rgba(0, 0, 0, 0.55)',
            },
        },
    },
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    const platform = {
        get OS() { return mocks.platform; },
        select: (values: Record<string, unknown>) => values[mocks.platform] ?? values.default,
    };
    return {
        Modal: host('Modal'),
        Platform: platform,
        Pressable: host('Pressable'),
        Text: host('Text'),
        View: host('View'),
        useWindowDimensions: () => ({ width: mocks.width, height: mocks.height }),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: mocks.safeBottom, left: 0 }),
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
        hairlineWidth: 1,
        create: (factory: any) => typeof factory === 'function' ? factory(mocks.lightTheme) : factory,
    },
    useUnistyles: () => ({ theme: mocks.dark ? mocks.darkTheme : mocks.lightTheme }),
}));

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({ fontFamily: 'HappyHerd' }) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./BubblePressable', async () => {
    const ReactModule = await import('react');
    return { BubblePressable: (props: any) => ReactModule.createElement('BubblePressable', props, props.children) };
});
vi.mock('./AnimatedOverlay', async () => {
    const ReactModule = await import('react');
    return {
        AnimatedPopup: (props: any) => ReactModule.createElement('AnimatedPopup', props, props.children),
        LocalBlurHalo: (props: any) => ReactModule.createElement('LocalBlurHalo', props),
    };
});
vi.mock('./MobileGlass', async () => {
    const ReactModule = await import('react');
    return {
        MobileGlassSurface: (props: any) => ReactModule.createElement('MobileGlassSurface', props, props.children),
    };
});

import { AttachmentInputButton } from './AttachmentInputButton';
import { getAttachmentInputMenuFrame } from './AttachmentInputMenu';
import { availableAttachmentInputActions } from './attachmentInputActions';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
    vi.stubGlobal('window', {
        addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
            if (type === 'keydown') mocks.keydown = listener;
        },
        removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
            if (type === 'keydown' && mocks.keydown === listener) mocks.keydown = null;
        },
    });
});

afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.useFakeTimers();
    mocks.platform = 'web';
    mocks.width = 1280;
    mocks.height = 800;
    mocks.anchor = { x: 980, y: 700, width: 32, height: 32 };
    mocks.safeBottom = 0;
    mocks.dark = false;
    mocks.focus.mockReset();
    mocks.keydown = null;
});

afterEach(() => vi.useRealTimers());

function renderButton(props: Partial<React.ComponentProps<typeof AttachmentInputButton>> = {}): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(
            React.createElement(AttachmentInputButton, {
                color: '#111111',
                ...props,
            }),
            {
                createNodeMock: (element: { type: string; props: Record<string, unknown> }) => {
                    if (element.props.testID === 'attachment-menu-anchor') {
                        return {
                            measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
                                callback(mocks.anchor.x, mocks.anchor.y, mocks.anchor.width, mocks.anchor.height);
                            },
                        };
                    }
                    if (element.props.testID === 'attachment-menu-photos') {
                        return { focus: mocks.focus };
                    }
                    return {};
                },
            },
        );
    });
    return renderer;
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((result, item) => ({ ...result, ...flattenStyle(item) }), {});
    }
    return typeof style === 'object' ? style as Record<string, unknown> : {};
}

function openMenu(renderer: ReactTestRenderer) {
    act(() => renderer.root.findByType('BubblePressable' as any).props.onPress());
}

describe('availableAttachmentInputActions', () => {
    it('exposes photos and device files behind one attachment entry', () => {
        expect(availableAttachmentInputActions({ photos: true, deviceFiles: true })).toEqual([
            'photos',
            'device-files',
        ]);
    });
});

describe('AttachmentInputButton', () => {
    it('stays hidden with zero available actions', () => {
        expect(renderButton().toJSON()).toBeNull();
    });

    it.each([
        ['photos', 'onPickPhotos'],
        ['device files', 'onPickDeviceFiles'],
    ] as const)('invokes the only available %s action directly', (_label, propName) => {
        const handler = vi.fn();
        const renderer = renderButton({ [propName]: handler });

        act(() => renderer.root.findByType('BubblePressable' as any).props.onPress());

        expect(handler).toHaveBeenCalledOnce();
        expect(renderer.root.findAllByType('Modal' as any)).toHaveLength(0);
    });

    it('renders the localized two-action web menu, focuses its first row, and invokes exact handlers', () => {
        const onPickPhotos = vi.fn();
        const onPickDeviceFiles = vi.fn();
        const renderer = renderButton({ onPickPhotos, onPickDeviceFiles });
        const trigger = renderer.root.findByType('BubblePressable' as any);

        expect(trigger.props.accessibilityLabel).toBe('happyHerd.composer.addAttachment');
        expect(trigger.props.accessibilityState).toEqual({ expanded: false });
        openMenu(renderer);
        act(() => vi.runOnlyPendingTimers());

        expect(renderer.root.findByProps({ testID: 'attachment-menu-web' })).toBeTruthy();
        expect(renderer.root.findByProps({ testID: 'attachment-menu-photos' }).props).toMatchObject({
            accessibilityLabel: 'happyHerd.composer.photos',
            accessibilityRole: 'menuitem',
        });
        expect(renderer.root.findByProps({ testID: 'attachment-menu-device-files' }).props).toMatchObject({
            accessibilityLabel: 'happyHerd.composer.deviceFiles',
            accessibilityRole: 'menuitem',
        });
        expect(mocks.focus).toHaveBeenCalledOnce();
        expect(renderer.root.findByType('BubblePressable' as any).props.accessibilityState).toEqual({ expanded: true });

        act(() => renderer.root.findByProps({ testID: 'attachment-menu-photos' }).props.onPress());
        expect(onPickPhotos).toHaveBeenCalledOnce();
        expect(onPickDeviceFiles).not.toHaveBeenCalled();
        expect(renderer.root.findAllByProps({ testID: 'attachment-menu-web' })).toHaveLength(0);

        openMenu(renderer);
        act(() => renderer.root.findByProps({ testID: 'attachment-menu-device-files' }).props.onPress());
        expect(onPickPhotos).toHaveBeenCalledOnce();
        expect(onPickDeviceFiles).toHaveBeenCalledOnce();
    });

    it('dismisses the web menu from its backdrop and Escape key', () => {
        const renderer = renderButton({ onPickPhotos: vi.fn(), onPickDeviceFiles: vi.fn() });
        openMenu(renderer);

        act(() => renderer.root.findByProps({ testID: 'attachment-menu-backdrop' }).props.onPress());
        expect(renderer.root.findAllByProps({ testID: 'attachment-menu-web' })).toHaveLength(0);

        openMenu(renderer);
        const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;
        act(() => mocks.keydown?.(event));
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(renderer.root.findAllByProps({ testID: 'attachment-menu-web' })).toHaveLength(0);
    });

    it('anchors wide and narrow web menus inside the viewport', () => {
        const wide = renderButton({ onPickPhotos: vi.fn(), onPickDeviceFiles: vi.fn() });
        openMenu(wide);
        expect(flattenStyle(wide.root.findByProps({ testID: 'attachment-menu-surface' }).parent?.props.style)).toMatchObject({
            left: 980,
            top: 544,
            width: 272,
        });

        act(() => wide.unmount());
        mocks.width = 240;
        mocks.height = 480;
        mocks.anchor = { x: 220, y: 420, width: 24, height: 24 };
        const narrow = renderButton({ onPickPhotos: vi.fn(), onPickDeviceFiles: vi.fn() });
        openMenu(narrow);
        expect(flattenStyle(narrow.root.findByProps({ testID: 'attachment-menu-surface' }).parent?.props.style)).toMatchObject({
            left: 12,
            top: 264,
            width: 216,
        });
    });

    it('uses theme-owned light and dark web surfaces', () => {
        const renderer = renderButton({ onPickPhotos: vi.fn(), onPickDeviceFiles: vi.fn() });
        openMenu(renderer);
        expect(flattenStyle(renderer.root.findByProps({ testID: 'attachment-menu-surface' }).props.style))
            .toMatchObject({ backgroundColor: '#ffffff' });

        mocks.dark = true;
        act(() => renderer.update(React.createElement(AttachmentInputButton, {
            color: '#ffffff',
            onPickPhotos: vi.fn(),
            onPickDeviceFiles: vi.fn(),
        })));
        expect(flattenStyle(renderer.root.findByProps({ testID: 'attachment-menu-surface' }).props.style))
            .toMatchObject({ backgroundColor: '#212121' });
    });

    it('renders a safe-area-aware native sheet and lets native Back dismiss it', () => {
        mocks.platform = 'android';
        mocks.width = 390;
        mocks.height = 844;
        mocks.safeBottom = 34;
        const renderer = renderButton({ onPickPhotos: vi.fn(), onPickDeviceFiles: vi.fn() });
        openMenu(renderer);

        expect(renderer.root.findByProps({ testID: 'attachment-menu-native' })).toBeTruthy();
        expect(flattenStyle(renderer.root.findByProps({ testID: 'attachment-menu-surface' }).props.style))
            .toMatchObject({ paddingBottom: 34, backgroundColor: 'rgba(255, 255, 255, 0.84)' });
        const modal = renderer.root.findByType('Modal' as any);
        expect(modal.props).toMatchObject({ navigationBarTranslucent: true, statusBarTranslucent: true });

        act(() => modal.props.onRequestClose());
        expect(renderer.root.findAllByProps({ testID: 'attachment-menu-native' })).toHaveLength(0);
    });
});

describe('getAttachmentInputMenuFrame', () => {
    it('opens below when space remains and above when the trigger is near the bottom', () => {
        expect(getAttachmentInputMenuFrame({
            anchor: { x: 40, y: 40, width: 32, height: 32 },
            windowWidth: 1280,
            windowHeight: 800,
        })).toEqual({ left: 40, top: 80, width: 272 });
        expect(getAttachmentInputMenuFrame({
            anchor: { x: 980, y: 700, width: 32, height: 32 },
            windowWidth: 1280,
            windowHeight: 800,
        })).toEqual({ left: 980, top: 544, width: 272 });
    });
});
