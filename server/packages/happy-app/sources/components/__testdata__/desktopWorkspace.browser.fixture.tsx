import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { DesktopFileWorkspace, DesktopFileWorkspaceSplit } from '@/components/DesktopFileWorkspace';
import { SidebarNavigator } from '@/components/SidebarNavigator';

function MountedWorkspaceProbe() {
    const [mountId] = React.useState(() => `mount-${Math.random()}`);
    const [draft, setDraft] = React.useState('retained draft');
    return (
        <div data-testid="mounted-workspace-probe" data-mount-id={mountId}>
            <input
                data-testid="mounted-workspace-input"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
            />
        </div>
    );
}

function WorkspaceSplitDemo() {
    return (
        <div data-testid="split-demo" style={{ width: 1100, height: 480 }}>
            <DesktopFileWorkspaceSplit
                workspaceVisible
                workspaceFullscreen={false}
                workspace={(
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <MountedWorkspaceProbe />
                        <FileWorkspaceContent compact={false} />
                    </div>
                )}
                fallback={null}
            >
                <div data-testid="main-agent-chat">Main Agent chat remains mounted</div>
            </DesktopFileWorkspaceSplit>
        </div>
    );
}

const noOp = () => {};

function FileWorkspaceContent({ compact }: { compact: boolean }) {
    return (
        <DesktopFileWorkspace
            sessionId="ordinary-session"
            paths={['/workspace/demo.md']}
            activePath="/workspace/demo.md"
            dirtyPaths={new Set()}
            pickerOpen={false}
            compact={compact}
            picker={<div>File picker</div>}
            onSelect={noOp}
            onRequestClose={noOp}
            onFileDeleted={() => {
                window.__WORKSPACE_FILE_DELETED_COUNT__ = (window.__WORKSPACE_FILE_DELETED_COUNT__ ?? 0) + 1;
            }}
            onOpenPicker={noOp}
            onDirtyChange={noOp}
        />
    );
}

function FileWorkspaceDemo({ compact, testId }: { compact: boolean; testId: string }) {
    const workspace = <FileWorkspaceContent compact={compact} />;

    if (compact) {
        return (
            <div
                data-testid={testId}
                style={{ position: 'relative', width: 390, height: 844, overflow: 'hidden' }}
            >
                <DesktopFileWorkspaceSplit
                    workspaceVisible={false}
                    workspaceFullscreen
                    workspace={workspace}
                    fallback={null}
                >
                    <div data-testid="compact-main-agent-chat">Hidden Main Agent chat</div>
                </DesktopFileWorkspaceSplit>
            </div>
        );
    }

    return (
        <div data-testid={testId} style={{ width: 900, height: 320 }}>
            {workspace}
        </div>
    );
}

declare global {
    interface Window {
        __DELETE_RPC_COUNT__?: number;
        __WORKSPACE_FILE_DELETED_COUNT__?: number;
    }
}

createRoot(document.getElementById('root')!).render(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div data-testid="sidebar-demo" style={{ position: 'relative', width: 600, height: 96, overflow: 'hidden' }}>
            <SidebarNavigator />
        </div>
        <WorkspaceSplitDemo />
        <FileWorkspaceDemo compact={false} testId="wide-file-workspace" />
        <FileWorkspaceDemo compact testId="narrow-file-workspace" />
    </div>,
);
