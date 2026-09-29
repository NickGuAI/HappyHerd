import React from 'react';
import { createRoot } from 'react-dom/client';
import { usePathname, useRouter } from 'expo-router';
// @ts-expect-error The browser fixture supplies this router-observation hook.
import { useFixtureOptions } from 'expo-router';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import UsageSettingsScreen from '@/app/(app)/settings/usage';
import { SettingsSectionList } from '@/components/herd/pages/SettingsFrame';
import { createHeader } from '@/components/navigation/Header';
import { HerdWindowInsetsContext } from '@/components/herd/shell/windowInsets';

const usageResponse = {
    usage: [{
        timestamp: Math.floor(Date.now() / 1000),
        tokens: { total: 350, claude: 100, codex: 200, grok: 50 },
        cost: { total: 0.12, claude: 0.1, grok: 0.02 },
        reportCount: 4,
    }],
    coverage: [
        { provider: 'claude', tokens: 'reported', cost: 'reported', limitations: [], costBasis: ['provider-estimate'] },
        { provider: 'codex', tokens: 'reported', cost: 'unavailable', limitations: ['cost-not-reported-by-provider'], costBasis: ['unavailable'] },
        { provider: 'grok', tokens: 'reported', cost: 'reported', limitations: [], costBasis: ['provider-reported'] },
        { provider: 'dsh', tokens: 'unavailable', cost: 'unavailable', limitations: ['tokens-not-reported-by-provider', 'cost-not-reported-by-provider'], costBasis: ['unavailable'] },
    ],
};

Object.assign(globalThis, {
    __USAGE_REQUESTS__: [] as unknown[],
    fetch: async (_url: string, options: { body?: string }) => {
        (globalThis as typeof globalThis & { __USAGE_REQUESTS__: unknown[] }).__USAGE_REQUESTS__.push(
            options.body ? JSON.parse(options.body) : null,
        );
        return {
            ok: true,
            status: 200,
            json: async () => usageResponse,
        };
    },
});

function Fixture() {
    const { theme } = useUnistyles();
    const path = usePathname();
    const router = useRouter();
    // The fixture replaces only router state and transport. Settings entry,
    // route, header, selectors and charts are the production components.
    const options = useFixtureOptions();
    return (
        <HerdWindowInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
            <View style={{ flex: 1 }}>
                {path === '/settings/usage' ? <>
                    {createHeader({ options: { headerTintColor: theme.colors.header.tint, headerShadowVisible: false, ...options }, route: { name: 'settings/usage' }, back: { title: 'Settings' }, navigation: { goBack: router.back } } as any)}
                    <UsageSettingsScreen />
                </> : <SettingsSectionList />}
            </View>
        </HerdWindowInsetsContext.Provider>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
