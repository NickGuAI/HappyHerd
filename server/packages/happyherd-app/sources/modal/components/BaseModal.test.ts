import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    platform: 'web',
    window: { width: 390, height: 844 },
    tablet: false,
    insets: { top: 47, right: 0, bottom: 34, left: 0 },
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    class Value {
        constructor(public value: number) {}
        interpolate() { return this; }
    }
    return {
        Platform: {
            get OS() { return mocks.platform; },
            select: (options: Record<string, unknown>) => options[mocks.platform] ?? options.default,
        },
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        Modal: host('Modal'),
        KeyboardAvoidingView: host('KeyboardAvoidingView'),
        TouchableWithoutFeedback: host('TouchableWithoutFeedback'),
        Animated: { Value, View: host('AnimatedView'), timing: () => ({ start() {} }) },
        StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {}, hairlineWidth: 1 },
        useWindowDimensions: () => mocks.window,
    };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return { useUnistyles: () => ({ theme: lightTheme }) };
});
vi.mock('@/components/AnimatedOverlay', () => ({ AnimatedBlurBackdrop: () => null }));
vi.mock('@/components/MobileGlass', () => ({ MobileGlassSurface: 'MobileGlassSurface' }));
vi.mock('@/components/herd/shell/windowInsets', () => ({ useWindowSafeAreaInsets: () => mocks.insets }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => mocks.tablet }));

import { BaseModal } from './BaseModal';
import { WebAlertModal } from './WebAlertModal';
import { useHerdPhoneDialog } from '@/components/herd/mobile/phoneDialog';

const renderers: ReactTestRenderer[] = [];
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(mocks, { platform: 'web', window: { width: 390, height: 844 }, tablet: false, insets: { top: 47, right: 0, bottom: 34, left: 0 } });
});

const flat = (style: any): Record<string, unknown> => Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
    : (style ?? {});

function DialogProbe() {
    return React.createElement('Probe', { phoneDialog: useHerdPhoneDialog() });
}

function renderDialog() {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(BaseModal, { visible: true, placement: 'dialog', children: React.createElement(DialogProbe) }));
    });
    renderers.push(renderer);
    return {
        container: flat(renderer.root.findByType('KeyboardAvoidingView' as any).props.style),
        phoneDialog: renderer.root.findByType('Probe' as any).props.phoneDialog as boolean,
    };
}

describe('dialog placement', () => {
    it('rests a dialog on the bottom edge of a phone-width browser window', () => {
        const { container, phoneDialog } = renderDialog();
        expect(container).toMatchObject({ justifyContent: 'flex-end', paddingBottom: 8 + 34 });
        expect(phoneDialog).toBe(true);
    });

    it('keeps a dialog centered in a 1024 × 768 browser window, though the device rule calls it a phone', () => {
        // An 8-inch diagonal: useIsTablet() is false, but the web lays out by width.
        mocks.window = { width: 1024, height: 768 };
        const { container, phoneDialog } = renderDialog();
        expect(container.justifyContent).toBe('center');
        expect(container.paddingBottom).toBeUndefined();
        // The duplicate and continuation sheets keep their centered width cap.
        expect(phoneDialog).toBe(false);
    });

    it.each([
        [699, 'flex-end', true],
        [700, 'center', false],
    ])('places a dialog at the %i px web breakpoint: %s', (width, justifyContent, phone) => {
        mocks.window = { width, height: 900 };
        const { container, phoneDialog } = renderDialog();
        expect(container.justifyContent).toBe(justifyContent);
        expect(phoneDialog).toBe(phone);
    });

    it('rests a dialog on the bottom edge of a native phone in landscape, where the device decides', () => {
        Object.assign(mocks, { platform: 'ios', window: { width: 844, height: 390 } });
        expect(renderDialog().container.justifyContent).toBe('flex-end');
        Object.assign(mocks, { tablet: true, window: { width: 1024, height: 1366 } });
        expect(renderDialog().container.justifyContent).toBe('center');
    });

    it('spans a phone-width browser window with the alert, and keeps its own width in a 1024 × 768 one', () => {
        const alert = () => {
            let renderer!: ReactTestRenderer;
            act(() => {
                renderer = create(React.createElement(WebAlertModal, {
                    config: { id: 'alert', type: 'alert', title: 'Archive session?', message: 'It leaves the list.' } as any,
                    onClose: vi.fn(),
                }));
            });
            renderers.push(renderer);
            return flat(renderer.root.findByType('MobileGlassSurface' as any).props.style);
        };
        expect(alert().width).toBe('100%');
        mocks.window = { width: 1024, height: 768 };
        expect(alert().width).not.toBe('100%');
    });
});
