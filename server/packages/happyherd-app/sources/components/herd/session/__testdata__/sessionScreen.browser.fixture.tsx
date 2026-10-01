import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { SessionView } from '@/-session/SessionView';
import { FlatSessionRow } from '@/components/FlatSessionRow';

/** Fixture tray renders the real Home row; storage projection is covered separately. */
function ArchiveJourneyRow() {
    const boundary = (window as any).__ARCHIVE_STORE__;
    const marked = React.useSyncExternalStore(boundary.subscribe,
        () => boundary.getState().archivingSessionIds.has('parent'));
    if (marked) return null;
    const session = boundary.getState().sessions.parent;
    const row = {
        session: {
            id: session.id, name: 'Archive journey row', subtitle: '/work/web-app',
            avatarId: session.id, flavor: 'claude', clientId: null, identityLine: null,
            providerKind: 'claude', modelName: null, activitySummary: null,
            gitChangedFiles: null, gitCountsExact: false, gitDeletions: null, gitInsertions: null,
            state: 'waiting', createdAt: session.createdAt, lastActivityAt: session.updatedAt,
            updateSequence: session.seq, hasDraft: false, active: true, archived: false,
            machineId: session.metadata?.machineId ?? null, machineOffline: false,
            daemonLabel: null, daemonShortId: null, hasUnread: false,
        },
        projectName: 'Archive verification', workspaceName: null,
    };
    return <View testID="archive-journey-row" style={{ flexShrink: 0 }}><FlatSessionRow row={row as any} /></View>;
}

// Review fixture: the production SessionView over synthetic storage/transport.
// The page background follows the app shell: raised slate on desktop, the
// grouped background on phones.
function SessionScreenFixture() {
    const { theme } = useUnistyles();
    const phone = window.innerWidth < 768;
    return (
        <View
            testID="foreground-session"
            style={{
                flex: 1,
                height: '100%',
                backgroundColor: phone ? theme.colors.groupped.background : theme.colors.surface,
            }}
        >
            {(window as any).__HAPPYHERD_FIXTURE_OPTIONS__?.archiveJourney ? <ArchiveJourneyRow /> : null}
            <SessionView id="parent" />
        </View>
    );
}

createRoot(document.getElementById('root')!).render(<SessionScreenFixture />);
