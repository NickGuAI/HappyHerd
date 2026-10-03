import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { SessionView } from '@/-session/SessionView';
import { FlatSessionRow } from '@/components/FlatSessionRow';
import { FileView } from '@/components/tools/views/FileView';
import { ToolView } from '@/components/tools/ToolView';
import { rgbaToThumbHash } from 'thumbhash';
import { ModalProvider } from '@/modal/ModalProvider';

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

/** Optional attachment scene: production FileView + real ToolView specialization. */
function AttachmentJourney() {
    const [revision, setRevision] = React.useState(0);
    const [input] = React.useState(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 24;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#005cbb'; context.fillRect(0, 0, 32, 24);
        context.fillStyle = '#ffc83d'; context.fillRect(6, 4, 20, 16);
        (window as any).__ATTACHMENT_PNG__ = canvas.toDataURL('image/png').split(',')[1];
        const hash = rgbaToThumbHash(32, 24, context.getImageData(0, 0, 32, 24).data);
        return { ref: 'fixture-attachment', name: 'chart.png', mimeType: 'image/png', image: {
            width: 640, height: 480, thumbhash: btoa(String.fromCharCode(...hash)),
        } };
    });
    const tool = React.useMemo(() => ({ name: 'file', state: 'completed' as const, input,
        createdAt: 1, startedAt: 1, completedAt: 1, description: null }), [input]);
    const metadata = { flavor: 'claude', path: '/fixture', summary: { text: `Revision ${revision}`, updatedAt: revision } } as any;
    return <View testID="attachment-journey" style={{ padding: 12 }}>
        {(window as any).__HAPPYHERD_FIXTURE_OPTIONS__.attachmentJourney === 'ToolView'
            ? <ToolView tool={tool} metadata={metadata} sessionId="parent" messageId="attachment" />
            : <FileView tool={tool} metadata={metadata} sessionId="parent" messages={[]} />}
        <button onClick={() => setRevision(value => value + 1)}>Update attachment metadata</button>
    </View>;
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

createRoot(document.getElementById('root')!).render((window as any).__HAPPYHERD_FIXTURE_OPTIONS__?.attachmentJourney ? <ModalProvider><AttachmentJourney /></ModalProvider> : <SessionScreenFixture />);
