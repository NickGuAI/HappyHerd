import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ width: 1440 }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Image: host('RNImage'),
        Platform: { OS: 'web' },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        View: host('View'),
        useWindowDimensions: () => ({ width: testState.width, height: 900 }),
    };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: (value: typeof lightTheme) => unknown) => factory(lightTheme),
        },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('expo-image', async () => {
    const ReactModule = await import('react');
    return { Image: (props: any) => ReactModule.createElement('ExpoImage', props) };
});
vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return { Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) } };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { ChangelogPageFrame } from './ChangelogPageFrame';
import { HerdTimelineGroup } from './HerdTimeline';

const originalConsoleError = console.error;
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
    testState.width = 1440;
});

function render(): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(React.Fragment, null,
            React.createElement(ChangelogPageFrame),
            React.createElement(HerdTimelineGroup, { index: 0, title: 'Newest', children: React.createElement('View') }),
            React.createElement(HerdTimelineGroup, { index: 1, title: 'Older', children: React.createElement('View') }),
        ));
    });
    return renderer;
}

const flat = (style: any): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : (style ?? {})
);

describe("What's New page (UI overhaul, mock fidelity)", () => {
    it('draws the large title and subtitle in the page and hides the header bar on wide web', () => {
        const renderer = render();
        expect(renderer.root.findByType('StackScreen' as any).props.options).toMatchObject({ headerShown: false });
        const header = renderer.root.findAll((node: any) => node.props?.testID === 'changelog-page-header' && node.type === 'View');
        expect(header).toHaveLength(1);
        const texts = header[0].findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(texts).toEqual(['navigation.whatsNew', 'updateBanner.seeLatest']);
    });

    it('keeps the header bar and draws no page title on phones', () => {
        testState.width = 390;
        const renderer = render();
        expect(renderer.root.findByType('StackScreen' as any).props.options).toMatchObject({ headerShown: true });
        expect(renderer.root.findAll((node: any) => node.props?.testID === 'changelog-page-header')).toHaveLength(0);
    });

    it('marks entries with the mock\'s 10 px rings, filled only for the newest', () => {
        const renderer = render();
        const markers = renderer.root.findAll((node: any) => node.type === 'View' && flat(node.props.style).position === 'absolute')
            .map((node: any) => flat(node.props.style));
        expect(markers).toHaveLength(2);
        for (const marker of markers) expect(marker).toMatchObject({ width: 10, height: 10, borderRadius: 5, borderWidth: 2 });
        expect(markers[0].backgroundColor).not.toBe(markers[1].backgroundColor);
    });
});
