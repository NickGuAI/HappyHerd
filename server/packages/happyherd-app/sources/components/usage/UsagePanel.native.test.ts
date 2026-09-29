import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    os: 'ios',
    dark: false,
    getUsage: vi.fn(async () => ({
        usage: [{ timestamp: 1_700_000_000, tokens: { total: 350, claude: 350 }, cost: { total: 0.12, claude: 0.12 } }],
        coverage: [],
    })),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { get OS() { return state.os; }, select: (options: any) => options[state.os] ?? options.default },
        View: host('View'), Text: host('Text'), ScrollView: host('ScrollView'),
        Pressable: host('Pressable'), ActivityIndicator: host('ActivityIndicator'),
        useWindowDimensions: () => ({ width: 390, height: 844 }),
    };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme, darkTheme } = await import('@/theme');
    const theme = () => state.dark ? darkTheme : lightTheme;
    return {
        useUnistyles: () => ({ theme: theme() }),
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: any) => new Proxy({}, { get: (_, key) => (typeof factory === 'function' ? factory(theme()) : factory)[key] }),
        },
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) },
        useRouter: () => ({ push: vi.fn(), navigate: vi.fn() }),
        usePathname: () => '/settings/usage',
    };
});
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/sync/storage', () => ({ useSetting: () => true }));
vi.mock('@/track', () => ({ trackWhatsNewClicked: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: { token: 'usage-fixture' } }) }));
vi.mock('@/sync/apiUsage', () => ({
    getUsageForPeriod: state.getUsage,
    calculateTotals: () => ({ totalTokens: 350, totalCost: 0.12, tokensByProvider: { claude: 350 }, costByProvider: { claude: 0.12 } }),
    usageMetricTotal: (point: any, metric: string) => point[metric].total,
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import UsageSettingsScreen from '@/app/(app)/settings/usage';
import { lightTheme, darkTheme } from '@/theme';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const originalError = console.error;
    vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalError(message, ...args);
    });
});
afterAll(() => vi.restoreAllMocks());

const flattened = (style: any): any => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe('Usage native route structure', () => {
    it.each(['ios', 'android'])('uses the shared title, cards and operable touch segments on %s in both themes', async (os) => {
        state.os = os;
        for (const dark of [false, true]) {
            state.dark = dark;
            state.getUsage.mockClear();
            const theme = dark ? darkTheme : lightTheme;
            let renderer: ReturnType<typeof create>;
            await act(async () => { renderer = create(React.createElement(UsageSettingsScreen)); });
            const hosts = (type: string) => renderer.root.findAll((node: any) => node.type === type);
            expect(hosts('StackScreen').some((node: any) => node.props.options.headerTitle === 'settings.usage')).toBe(true);
            expect(hosts('ScrollView').filter((node: any) => !node.props.horizontal)).toHaveLength(1);
            const summary = hosts('View').find((node: any) => node.props.testID === 'usage-summary');
            expect(summary).toBeDefined();
            const cards = hosts('View').filter((node: any) => ['usage-stat-tokens', 'usage-stat-cost'].includes(node.props.testID));
            expect(cards).toHaveLength(2);
            for (const card of cards) {
                expect(flattened(card.props.style)).toMatchObject({
                    borderRadius: theme.kilv.radiusCard,
                    backgroundColor: theme.colors.kilv.bgRaised,
                    borderColor: theme.colors.kilv.hair,
                    borderWidth: 1,
                });
            }
            const radio = (label: string) => hosts('Pressable').find((node: any) => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === label);
            expect(radio('usage.last7Days').props['aria-checked']).toBe(true);
            expect(flattened(radio('usage.today').props.style).minHeight).toBeGreaterThanOrEqual(44);
            await act(async () => { radio('usage.cost').props.onPress(); });
            expect(radio('usage.cost').props['aria-checked']).toBe(true);
            const chartBars = hosts('View').filter((node: any) => node.props.testID === 'usage-chart-bar');
            expect(flattened(chartBars[0].props.style).backgroundColor).toBe(theme.colors.kilv.accentHot);
            await act(async () => { radio('usage.today').props.onPress(); });
            expect(state.getUsage).toHaveBeenLastCalledWith({ token: 'usage-fixture' }, 'today', undefined);
            expect(radio('usage.cost').props['aria-checked']).toBe(true);
            await act(async () => { renderer.unmount(); });
        }
    });
});
