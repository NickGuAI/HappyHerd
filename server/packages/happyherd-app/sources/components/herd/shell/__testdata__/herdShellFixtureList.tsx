import * as React from 'react';

import { FlatSessionRow } from '@/components/FlatSessionRow';
import { CompactSessionRow } from '@/components/ActiveSessionsGroupCompact';
import { useFixtureSelection } from './herdShellFixtureState';

const now = 1_800_000_000_000;
const base = {
    subtitle: '', clientId: null, modelName: null, activitySummary: null,
    gitChangedFiles: null, gitCountsExact: true, gitDeletions: null, gitInsertions: null,
    createdAt: now - 86_400_000, updateSequence: 1, hasDraft: false, archived: false,
    daemonLabel: 'studio-mac', daemonShortId: 'studio-mac', machineName: 'studio-mac', botId: null, botUsername: null,
    commanderId: null, commanderName: null, machineOffline: false, homeDir: '/Users/reviewer',
    completedTodosCount: 0, totalTodosCount: 0, hasUnread: false, identityLine: null, providerKind: null,
    sessionAvatarUri: null, sessionAvatarThumbhash: null,
};
const row = (id: string, name: string, overrides: Record<string, unknown>, projectName: string, workspaceName: string | null = null) => ({
    session: {
        ...base, id, name, avatarId: id, flavor: 'claude', state: 'waiting', active: true,
        lastActivityAt: now, machineId: 'studio-mac', path: `/Users/reviewer/Projects/${projectName}`, ...overrides,
    },
    projectName,
    workspaceName,
});

export const fixtureRows = [
    row('auth', 'Refresh token rotation', { state: 'permission_required', flavor: 'claude' }, 'happyherd', 'fix-refresh-rotation'),
    row('dock', 'Composer chips and context meter', { state: 'thinking', flavor: 'codex', gitChangedFiles: 3, gitInsertions: 42, gitDeletions: 7 }, 'happyherd'),
    row('question', 'Pick the release channel', { state: 'input_required', flavor: 'gemini' }, 'release-notes'),
    row('unread', 'Nightly flaky test triage', { hasUnread: true, flavor: 'dsh' }, 'ci-infra', 'triage-0927'),
    row('offline', 'GPU benchmark sweep', { state: 'disconnected', machineOffline: true, flavor: 'grok', machineId: 'gpu-lab', daemonLabel: 'gpu-lab', daemonShortId: 'gpu-lab' }, 'bench'),
] as any[];

export const compactRows = [
    row('compact-a', 'Workspace grouped: docs pass', { flavor: 'claude', identityLine: 'Claude Code · Anthropic' }, 'docs'),
    row('compact-b', 'Workspace grouped: lint sweep', { flavor: 'codex' }, 'docs'),
] as any[];

/** Stands in for MainView's session list: the real rows, selected like the sidebar selects them. */
export function FixtureSessionList() {
    const selected = useFixtureSelection();
    return (
        <div data-testid="fixture-session-list" style={{ flex: 1, overflowY: 'auto', paddingTop: 6 }}>
            {fixtureRows.map((item, index) => (
                <FlatSessionRow key={item.session.id} row={item} selected={item.session.id === selected} entranceIndex={index} />
            ))}
            {/* Workspace grouping renders the compact row. */}
            {compactRows.map((item) => (
                <CompactSessionRow key={item.session.id} session={item.session} selected={item.session.id === selected} />
            ))}
        </div>
    );
}
