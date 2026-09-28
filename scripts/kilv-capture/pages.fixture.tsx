// Screenshot-only host for the overhauled secondary pages (UI overhaul).
// Every displayed panel is a real production import; only service and state
// boundaries are synthetic (see pages.capture.mjs).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Automations from '@/app/(app)/automations/index';
import Commanders from '@/app/(app)/commanders/index';
import Projects from '@/app/(app)/projects/index';
import Project from '@/app/(app)/projects/[id]';
import Inbox from '@/app/(app)/inbox/index';
import SettingsIndex from '@/app/(app)/settings/index';
import SettingsAccount from '@/app/(app)/settings/account';
import Appearance from '@/app/(app)/settings/appearance';
import Language from '@/app/(app)/settings/language';
import SessionInfo from '@/app/(app)/session/[id]/info';
import Machine from '@/app/(app)/machine/[id]';
import Changelog from '@/app/(app)/changelog';
import { FocusModeControl } from '@/components/FocusModeControl';
import { CommandPalette } from '@/components/CommandPalette/CommandPalette';
import { CommandPaletteModal } from '@/components/CommandPalette/CommandPaletteModal';
import type { Command } from '@/components/CommandPalette/types';
import { t } from '@/text';
import '@/theme.css';

// A header bar hosting the real Focus control above the Projects page.
function FocusBar() {
    const { theme } = useUnistyles();
    return (
        <View style={{ flex: 1 }}>
            <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 16, backgroundColor: theme.colors.header.background, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                <FocusModeControl />
            </View>
            <Projects />
        </View>
    );
}

function Palette() {
    const commands: Command[] = [
        { id: 'new-session', title: t('uiCopy.newSession'), subtitle: t('uiCopy.startANewChatSession'), icon: 'add-circle-outline', category: 'Sessions', shortcut: '⌥⌘N', action: () => {} },
        { id: 'sessions', title: t('uiCopy.viewAllSessions'), subtitle: t('uiCopy.browseYourChatHistory'), icon: 'chatbubbles-outline', category: 'Sessions', action: () => {} },
        { id: 'create-commander', title: t('happyHerd.commander.createTitle'), subtitle: t('happyHerd.commander.createSubtitle'), icon: 'person-add-outline', category: t('happyHerd.commander.category'), action: () => {} },
        { id: 'commanders', title: t('happyHerd.commander.category'), subtitle: t('happyHerd.commander.browseSubtitle'), icon: 'people-outline', category: t('happyHerd.commander.category'), action: () => {} },
        { id: 'settings', title: t('tabs.settings'), subtitle: t('uiCopy.configureYourPreferences'), icon: 'settings-outline', category: 'Navigation', shortcut: '⌥⌘,', action: () => {} },
        { id: 'account', title: t('settings.account'), subtitle: t('uiCopy.manageYourAccount'), icon: 'person-circle-outline', category: 'Navigation', action: () => {} },
        { id: 'connect', title: t('uiCopy.connectDevice'), subtitle: t('uiCopy.connectANewDeviceViaWeb'), icon: 'link-outline', category: 'Navigation', action: () => {} },
        { id: 'session-auth', title: 'Refactor auth middleware', subtitle: '~/code/web-app', icon: 'time-outline', category: t('uiCopy.recentSessions'), action: () => {} },
        { id: 'session-docs', title: 'Release notes draft', subtitle: '~/code/docs', icon: 'time-outline', category: t('uiCopy.recentSessions'), action: () => {} },
        { id: 'sign-out', title: t('uiCopy.signOut'), subtitle: t('uiCopy.signOutOfYourAccount'), icon: 'log-out-outline', category: 'System', action: () => {} },
    ];
    return (
        <>
            <Projects />
            <CommandPaletteModal visible>
                <CommandPalette commands={commands} onClose={() => {}} />
            </CommandPaletteModal>
        </>
    );
}

const scenes: Record<string, React.ComponentType> = {
    automations: Automations,
    commanders: Commanders,
    projects: Projects,
    project: Project,
    inbox: Inbox,
    settings: SettingsIndex,
    appearance: Appearance,
    'session-info': SessionInfo,
    machine: Machine,
    changelog: Changelog,
    focus: FocusBar,
    palette: Palette,
};

// Routes the production pages navigate to inside this fixture.
const routes: Record<string, React.ComponentType> = {
    '/settings': SettingsIndex,
    '/settings/account': SettingsAccount,
    '/settings/appearance': Appearance,
    '/settings/language': Language,
    '/projects/fixture-id': Project,
    '/commanders': Commanders,
};

function Fixture() {
    const { theme } = useUnistyles();
    const initial = new URLSearchParams(location.search).get('scene') || 'automations';
    const [route, setRoute] = React.useState<string | null>(null);
    // A layout effect, so a page's Redirect (a passive effect) finds it on first render.
    React.useLayoutEffect(() => {
        (window as any).__FIXTURE_NAVIGATE__ = (next: string) => {
            (window as any).__FIXTURE_ROUTES__ = [...((window as any).__FIXTURE_ROUTES__ ?? []), next];
            if (routes[next]) setRoute(next);
        };
    }, []);
    const Panel = (route && routes[route]) || scenes[initial];
    return (
        <View style={{ minHeight: '100vh', height: '100vh', backgroundColor: theme.colors.groupped.background }}>
            <Panel key={route ?? initial} />
        </View>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
