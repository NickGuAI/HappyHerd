import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ width: 1200, platform: 'ios' }));
vi.mock('react-native', () => ({
    Platform: { get OS() { return host.platform; } },
    useWindowDimensions: () => ({ width: host.width, height: 900 }),
    View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('react-native-unistyles', () => {
    const theme: any = new Proxy({}, { get: (_target, key) => key === Symbol.toPrimitive ? () => '#777' : theme });
    return { StyleSheet: { create: (value: any) => typeof value === 'function' ? value(theme) : value }, useUnistyles: () => ({ theme }) };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' }, usePathname: () => '/settings/appearance', useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 960 } }));
vi.mock('@/sync/storage', () => ({ useSetting: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/track', () => ({ trackWhatsNewClicked: vi.fn() }));
import { SettingsFrame, useSettingsFrameVisible } from './SettingsFrame';
import { useHerdWideLayout } from './HerdPage';

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

describe('native window layout', () => {
    it.each(['ios', 'web', 'android'])('uses the page and Settings width thresholds on %s', (platform) => {
        host.platform = platform;
        function Probe() {
            return React.createElement('Probe', { page: useHerdWideLayout(), settings: useSettingsFrameVisible() });
        }
        let renderer: any;
        for (const [width, page, settings] of [[899, false, false], [900, true, false], [999, true, false], [1000, true, true]] as const) {
            host.width = width;
            act(() => { if (renderer) renderer.update(React.createElement(Probe)); else renderer = create(React.createElement(Probe)); });
            expect(renderer.root.findByType('Probe').props).toEqual({ page, settings });
        }
        act(() => renderer.unmount());
    });

    it('retains native unsaved settings when the section list appears and disappears', () => {
        host.platform = 'ios'; host.width = 800;
        let mounts = 0;
        function Draft() {
            const [text, setText] = React.useState('initial');
            React.useEffect(() => { mounts += 1; }, []);
            return React.createElement('Draft', { text, setText });
        }
        const render = () => React.createElement(SettingsFrame, { section: 'appearance', children: React.createElement(Draft) });
        let renderer: any;
        act(() => { renderer = create(render()); });
        act(() => renderer.root.findByType('Draft').props.setText('unsaved'));
        host.width = 1200;
        act(() => renderer.update(render()));
        expect(renderer.root.findAll((node: any) => node.props.testID === 'settings-nav').length).toBeGreaterThan(0);
        expect(renderer.root.findByType('Draft').props.text).toBe('unsaved');
        host.width = 600;
        act(() => renderer.update(render()));
        expect(renderer.root.findAll((node: any) => node.props.testID === 'settings-nav')).toHaveLength(0);
        expect(renderer.root.findByType('Draft').props.text).toBe('unsaved');
        expect(mounts).toBe(1);
        act(() => renderer.unmount());
    });
});
