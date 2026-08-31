import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { DesktopFileWorkspace, DesktopFileWorkspaceSplit } from '@/components/DesktopFileWorkspace';
import {
    closeDesktopFile,
    EMPTY_DESKTOP_FILE_WORKSPACE,
    openDesktopFile,
    selectDesktopFile,
} from '@/components/desktopFileWorkspaceModel';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import { useLocalSetting } from '@/sync/storage';

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
        <div
            data-testid="split-demo"
            style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0, height: 480 }}
        >
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

function IntegratedDesktopDemo() {
    const navigationSidebarCollapsed = useLocalSetting('navigationSidebarCollapsed');

    return (
        <div
            data-testid="integrated-desktop-demo"
            style={{ display: 'flex', width: 1400, height: 480 }}
        >
            <div
                data-testid="sidebar-demo"
                style={{
                    position: 'relative',
                    flex: '0 0 auto',
                    width: navigationSidebarCollapsed ? 0 : 360,
                    height: 480,
                    zIndex: 1,
                }}
            >
                <SidebarNavigator />
            </div>
            <WorkspaceSplitDemo />
        </div>
    );
}

function FileWorkspaceContent({ compact }: { compact: boolean }) {
    const [workspace, setWorkspace] = React.useState(() => (
        openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/workspace/demo.md')
    ));
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [dirtyPaths, setDirtyPaths] = React.useState<Set<string>>(() => new Set());

    const openFile = React.useCallback((path: string) => {
        setWorkspace((current) => openDesktopFile(current, path));
        setPickerOpen(false);
    }, []);
    const closeFile = React.useCallback((path: string) => {
        setWorkspace((current) => closeDesktopFile(current, path));
        setDirtyPaths((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
        });
    }, []);
    const selectFile = React.useCallback((path: string) => {
        setWorkspace((current) => selectDesktopFile(current, path));
        setPickerOpen(false);
    }, []);
    const handleFileDeleted = React.useCallback(() => {
        window.__WORKSPACE_FILE_DELETED_COUNT__ = (window.__WORKSPACE_FILE_DELETED_COUNT__ ?? 0) + 1;
    }, []);
    const handleDirtyChange = React.useCallback((path: string, dirty: boolean) => {
        setDirtyPaths((current) => {
            if (current.has(path) === dirty) return current;
            const next = new Set(current);
            if (dirty) next.add(path);
            else next.delete(path);
            return next;
        });
    }, []);

    return (
        <DesktopFileWorkspace
            sessionId="ordinary-session"
            paths={workspace.paths}
            activePath={workspace.activePath}
            dirtyPaths={dirtyPaths}
            pickerOpen={pickerOpen}
            compact={compact}
            picker={(
                <div data-testid="file-picker">
                    <button onClick={() => openFile('/workspace/demo.md')}>Open demo.md</button>
                    <button onClick={() => openFile('/workspace/second.md')}>Open second.md</button>
                </div>
            )}
            onSelect={selectFile}
            onRequestClose={closeFile}
            onFileDeleted={handleFileDeleted}
            onOpenPicker={() => setPickerOpen(true)}
            onDirtyChange={handleDirtyChange}
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
        <IntegratedDesktopDemo />
        <FileWorkspaceDemo compact={false} testId="wide-file-workspace" />
        <FileWorkspaceDemo compact testId="narrow-file-workspace" />
    </div>,
);
