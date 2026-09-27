import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { ChatHeaderView } from '@/components/ChatHeaderView';
import { MainView } from '@/components/MainView';
import { createHeader } from '@/components/navigation/Header';
import { HerdMachineMenu } from '@/components/herd/shell/HerdMachineMenu';
import { FixtureSessionsListWrapper } from './mobileShellFixtureList';
import { useFixturePath } from './mobileShellRouter';

/** A full-screen phone page: the shared back header over a page body. */
function PageStandIn({ path }: { path: string }) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const title = path.split('/').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' · ');
    return (
        <View testID="fixture-page" style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
            {createHeader({
                options: { headerTitle: title, headerTintColor: theme.colors.header.tint },
                route: { key: path, name: path },
                back: { title: 'Back', href: undefined },
                navigation: { goBack: () => router.back() },
            } as any)}
            <View style={{ padding: 16 }}>
                <Text style={{ color: theme.colors.textSecondary, fontFamily: 'SpaceGrotesk-Regular' }}>{path}</Text>
            </View>
        </View>
    );
}

/** A full-screen session: the session slice's real header, which owns Back on phones. */
function SessionStandIn({ path }: { path: string }) {
    const router = useRouter();
    const { theme } = useUnistyles();
    return (
        <View testID="fixture-session" style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
            <ChatHeaderView title="Refresh token rotation" folderName="web-app" onBackPress={() => router.back()} />
            <View style={{ padding: 16 }}>
                <Text style={{ color: theme.colors.textSecondary, fontFamily: 'SpaceGrotesk-Regular' }}>{path}</Text>
            </View>
        </View>
    );
}

/** Desktop width: the same menus stay anchored cards next to their triggers. */
function DesktopStandIn() {
    const { theme } = useUnistyles();
    return (
        <View testID="fixture-desktop" style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.groupped.background }}>
            <View style={{ width: 360, borderRightWidth: 1, borderRightColor: theme.colors.divider }}>
                <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 12 }}>
                    <HerdMachineMenu compact={false} />
                </View>
                <FixtureSessionsListWrapper />
            </View>
        </View>
    );
}

function FixtureApp() {
    const path = useFixturePath();
    if (new URLSearchParams(window.location.search).get('screen') === 'desktop') return <DesktopStandIn />;
    if (path === '/') return <MainView variant="phone" />;
    if (path.startsWith('/session/')) return <SessionStandIn path={path} />;
    return <PageStandIn path={path} />;
}

createRoot(document.getElementById('root')!).render(<FixtureApp />);
