import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionView } from '@/-session/SessionView';
import { FlatSessionRow } from '@/components/FlatSessionRow';
import { ProviderContinuationLinks } from '@/components/ProviderContinuationLinks';
import { useSession } from '@/sync/storage';

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
        <div data-testid="foreground-session" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <SessionView id="parent" />
        </div>
        <div style={{ display: 'none' }} aria-hidden="true">
            <SessionView id="background" />
        </div>
        {fixtureOptions.providerContinuation ? <ProviderContinuationFixture /> : null}
    </>,
);
