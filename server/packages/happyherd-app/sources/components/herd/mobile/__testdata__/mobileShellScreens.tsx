import * as React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { PhoneHome } from '@/components/herd/mobile/PhoneHome';
import { isHerdPhoneTopLevelRoute } from '@/components/herd/shell/phoneRoutes';
import { createHeader } from '@/components/navigation/Header';
import { useFixturePath } from './mobileShellRouter';

/** Expo Router's stack route name for a fixture path: `/settings` → `settings/index`. */
function routeName(path: string): string {
    const clean = path.split('?')[0].replace(/^\//, '');
    return clean.includes('/') ? clean : `${clean}/index`;
}

/**
 * A stack page: the shared navigation header over a page body, with the same
 * `headerBackVisible` rule `(app)/_layout.tsx` gives phone routes.
 */
function PageStandIn({ path }: { path: string }) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const name = routeName(path);
    const title = path.split('/').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' · ');
    return (
        <View testID="fixture-page" style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            {createHeader({
                options: {
                    headerTitle: title,
                    headerTintColor: theme.colors.header.tint,
                    ...(isHerdPhoneTopLevelRoute(name) ? { headerBackVisible: false } : {}),
                },
                route: { key: path, name },
                back: { title: 'Back', href: undefined },
                navigation: { goBack: () => router.back() },
            } as any)}
            <View style={{ padding: 16 }}>
                <Text style={{ color: theme.colors.textSecondary, fontFamily: 'SpaceGrotesk-Regular' }}>{path}</Text>
            </View>
        </View>
    );
}

/** A session route: its own slice owns the header, so this only marks where the screen starts. */
function SessionStandIn({ path }: { path: string }) {
    const { theme } = useUnistyles();
    return (
        <View testID="fixture-session" style={{ flex: 1, padding: 16, backgroundColor: theme.colors.surface }}>
            <Text style={{ color: theme.colors.textSecondary, fontFamily: 'SpaceGrotesk-Regular' }}>{path}</Text>
        </View>
    );
}

/** Stands in for the navigator's stack: the screen for the fixture router's current path. */
export function FixtureScreens() {
    const path = useFixturePath();
    if (path === '/') return <PhoneHome />;
    if (path.startsWith('/session/')) return <SessionStandIn path={path} />;
    return <PageStandIn path={path} />;
}
