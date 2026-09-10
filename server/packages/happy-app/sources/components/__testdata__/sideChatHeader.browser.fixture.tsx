import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionView } from '@/-session/SessionView';
import SessionInfoScreen from '@/app/(app)/session/[id]/info';
import NewSessionScreen from '@/app/(app)/new/index';
import AgentDefaultsSettingsScreen from '@/app/(app)/settings/agents';
import { FlatSessionRow } from '@/components/FlatSessionRow';
import { HomeDock } from '@/components/HomeDock';
import { ProviderContinuationLinks } from '@/components/ProviderContinuationLinks';
import { storage, useSession } from '@/sync/storage';

function SessionInfoJourneyFixture() {
    const [screen, setScreen] = React.useState<'session' | 'info'>('session');
    const [openChangesRequestId, setOpenChangesRequestId] = React.useState<string | undefined>();
    const sessionRouteKey = 'session-parent-key';

    (globalThis as any).__HAPPYHERD_ROUTE_PARAMS__ = { id: 'parent' };
    (globalThis as any).__HAPPYHERD_ROUTE_STATE__ = {
        index: screen === 'info' ? 1 : 0,
        routes: [
            {
                key: sessionRouteKey,
                name: 'session/[id]',
                params: { id: 'parent', ...(openChangesRequestId ? { openChangesRequestId } : {}) },
            },
            ...(screen === 'info'
                ? [{ key: 'info-parent-key', name: 'session/[id]/info', params: { id: 'parent' } }]
                : []),
        ],
    };
    (globalThis as any).__HAPPYHERD_ROUTE_PUSH__ = (href: string) => {
        if (href === '/session/parent/info') setScreen('info');
    };
    (globalThis as any).__HAPPYHERD_ROUTE_ACTION__ = (action: any) => {
        (globalThis as any).__INFO_NAV_ACTIONS__ = [
            ...((globalThis as any).__INFO_NAV_ACTIONS__ ?? []),
            action,
        ];
        if (action.type === 'SET_PARAMS' && action.source === sessionRouteKey) {
            setOpenChangesRequestId(action.payload?.params?.openChangesRequestId);
        }
        if (action.type === 'POP') setScreen('session');
    };
    (globalThis as any).__HAPPYHERD_ROUTE_BACK__ = () => {
        (globalThis as any).__INFO_BACK_COUNT__ = ((globalThis as any).__INFO_BACK_COUNT__ ?? 0) + 1;
        setScreen('session');
    };

    return (
        <>
            <div
                data-route-key={sessionRouteKey}
                data-testid="foreground-session"
                style={{ display: screen === 'session' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
            >
                <SessionView
                    id="parent"
                    openChangesRequestId={screen === 'session' ? openChangesRequestId : undefined}
                    onOpenChangesRequestConsumed={(requestId) => {
                        (globalThis as any).__INFO_CONSUMED_REQUESTS__ = [
                            ...((globalThis as any).__INFO_CONSUMED_REQUESTS__ ?? []),
                            requestId,
                        ];
                        setOpenChangesRequestId((current) => current === requestId ? undefined : current);
                    }}
                />
            </div>
            {screen === 'info' ? (
                <div data-testid="session-info-route" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <SessionInfoScreen />
                </div>
            ) : null}
        </>
    );
}

function BotActionMenuFixture() {
    const session = useSession('parent');
    (globalThis as any).__APPLY_BOT_ARCHIVE_SYNC__ = (
        storage as unknown as { __applyBotArchiveSync?: () => void }
    ).__applyBotArchiveSync;
    if (!session) return null;
    if (!session.active) {
        return <div data-session-id={session.id} data-testid="bot-archive-synced">Archived bot session</div>;
    }
    const row = {
        projectName: 'happyherd',
        workspaceName: 'bot-workspace',
        session: {
            id: session.id,
            name: 'Bot assistant',
            active: session.active,
            activitySummary: null,
            clientId: null,
            commanderId: null,
            commanderName: null,
            daemonLabel: 'MainEC2',
            daemonShortId: 'machine-1',
            flavor: 'rig',
            gitChangedFiles: null,
            gitCountsExact: true,
            gitDeletions: 0,
            gitInsertions: 0,
            hasDraft: false,
            hasUnread: false,
            identityLine: 'Bot',
            lastActivityAt: 1,
            machineId: 'machine-1',
            machineOffline: false,
            modelName: null,
            providerKind: 'rig',
            state: 'waiting',
        },
    };
    return (
        <div data-session-id={session.id} data-testid="bot-action-menu">
            <FlatSessionRow row={row as any} />
        </div>
    );
}

function HomeDockFixture() {
    const [prompt, setPrompt] = React.useState('Inspect attachments');

    return (
        <div data-testid="home-dock" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <HomeDock
                prompt={prompt}
                onPromptChange={setPrompt}
                onSubmit={async (entries = []) => {
                    (globalThis as any).__HOME_DOCK_SUBMITS__ = [
                        ...((globalThis as any).__HOME_DOCK_SUBMITS__ ?? []),
                        entries,
                    ];
                    return true;
                }}
                isSubmitting={false}
                showBottomBackdrop={false}
            />
        </div>
    );
}

function ProviderContinuationFixture() {
    const [modalConfig, setModalConfig] = React.useState<any>(null);
    const legacyClaudeContinuation = fixtureOptions.legacyClaudeContinuation === true;

    React.useEffect(() => {
        const handleModal = () => setModalConfig((globalThis as any).__HAPPYHERD_MODAL_CONFIG__ ?? null);
        globalThis.addEventListener('happyherd-test-modal', handleModal);
        return () => globalThis.removeEventListener('happyherd-test-modal', handleModal);
    }, []);

    const ModalComponent = modalConfig?.component;
    const targetSession = useSession('target-session');
    const row = {
        projectName: 'happyherd',
        workspaceName: 'calm-forest',
        session: {
            id: 'parent',
            name: 'Continuation source',
            active: true,
            activitySummary: null,
            clientId: null,
            commanderId: 'commander-1',
            commanderName: 'Athena',
            daemonLabel: 'MainEC2',
            daemonShortId: 'machine-1',
            flavor: legacyClaudeContinuation ? null : 'codex',
            gitChangedFiles: null,
            gitCountsExact: true,
            gitDeletions: 0,
            gitInsertions: 0,
            hasDraft: false,
            hasUnread: false,
            identityLine: legacyClaudeContinuation ? 'Claude' : 'Codex',
            lastActivityAt: 1,
            machineId: 'machine-1',
            machineOffline: false,
            modelName: null,
            providerKind: legacyClaudeContinuation ? 'claude' : 'codex',
            state: 'waiting',
        },
    };
    return (
        <div data-testid="provider-continuation-fixture">
            <FlatSessionRow row={row as any} />
            {ModalComponent ? (
                <ModalComponent
                    {...modalConfig.props}
                    onClose={() => {
                        (globalThis as any).__HAPPYHERD_MODAL_CONFIG__ = null;
                        setModalConfig(null);
                    }}
                />
            ) : null}
            {targetSession ? <ProviderContinuationLinks session={targetSession} /> : null}
        </div>
    );
}

const fixtureOptions = (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ ?? {};

createRoot(document.getElementById('root')!).render(
    <>
        {fixtureOptions.sessionInfoJourney ? (
            <SessionInfoJourneyFixture />
        ) : fixtureOptions.botActionMenu ? (
            <BotActionMenuFixture />
        ) : fixtureOptions.agentSettings ? (
            <div data-testid="agent-settings" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <AgentDefaultsSettingsScreen />
            </div>
        ) : fixtureOptions.homeDock ? (
            <HomeDockFixture />
        ) : fixtureOptions.newSession ? (
            <div data-testid="full-new-session" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <NewSessionScreen />
            </div>
        ) : (
            <>
                <div data-testid="foreground-session" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <SessionView id="parent" />
                </div>
                <div style={{ display: 'none' }} aria-hidden="true">
                    <SessionView id="background" />
                </div>
            </>
        )}
        {fixtureOptions.providerContinuation ? <ProviderContinuationFixture /> : null}
    </>,
);
