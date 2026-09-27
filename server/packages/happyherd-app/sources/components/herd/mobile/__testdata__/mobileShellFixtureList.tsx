import * as React from 'react';
import { ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { FlatSessionRow } from '@/components/FlatSessionRow';

const now = 1_800_000_000_000;
const base = {
    subtitle: '', clientId: null, modelName: null, activitySummary: null,
    gitChangedFiles: null, gitCountsExact: true, gitDeletions: null, gitInsertions: null,
    createdAt: now - 86_400_000, updateSequence: 1, hasDraft: false, archived: false,
    daemonLabel: 'studio-mac', daemonShortId: 'studio-mac', machineName: 'studio-mac', botId: null, botUsername: null,
    commanderId: null, commanderName: null, machineOffline: false, homeDir: '/Users/jordan',
    completedTodosCount: 0, totalTodosCount: 0, hasUnread: false, identityLine: null, providerKind: null,
    sessionAvatarUri: null, sessionAvatarThumbhash: null,
};
const row = (id: string, name: string, overrides: Record<string, unknown>, projectName: string) => ({
    session: {
        ...base, id, name, avatarId: id, flavor: 'claude', state: 'waiting', active: true,
        lastActivityAt: now, machineId: 'studio-mac', path: `/Users/jordan/code/${projectName}`, ...overrides,
    },
    projectName,
    workspaceName: null,
});

export const fixtureRows = [
    row('auth', 'Refresh token rotation', { state: 'permission_required' }, 'web-app'),
    row('dock', 'Composer chips and context meter', { state: 'thinking', flavor: 'codex', gitChangedFiles: 3, gitInsertions: 42, gitDeletions: 7 }, 'happyherd'),
    row('question', 'Pick the release channel', { state: 'input_required', flavor: 'gemini' }, 'release-notes'),
    row('unread', 'Nightly flaky test triage', { hasUnread: true, flavor: 'dsh' }, 'ci-infra'),
    row('offline', 'GPU benchmark sweep', { state: 'disconnected', machineOffline: true, flavor: 'grok', machineId: 'gpu-lab', daemonLabel: 'gpu-lab', daemonShortId: 'gpu-lab' }, 'bench'),
    row('docs', 'Docs site navigation pass', { flavor: 'claude' }, 'docs'),
] as any[];

/** Stands in for SessionsListWrapper: the real session rows, with the list insets MainView passes. */
export function FixtureSessionsListWrapper({ bottomContentInset = 0 }: { bottomContentInset?: number }) {
    const { theme } = useUnistyles();
    return (
        <ScrollView
            testID="fixture-session-list"
            // The same page background SessionsListWrapper paints.
            style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}
            contentContainerStyle={{ paddingTop: 6, paddingBottom: bottomContentInset }}
        >
            {fixtureRows.map((item, index) => (
                <FlatSessionRow key={item.session.id} row={item} entranceIndex={index} />
            ))}
        </ScrollView>
    );
}
