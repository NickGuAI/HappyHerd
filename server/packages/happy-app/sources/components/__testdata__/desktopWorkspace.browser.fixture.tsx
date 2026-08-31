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
    const reference = { machineId: 'machine-1', source: 'session' as const };
    const [workspace, setWorkspace] = React.useState(() => (
        openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/workspace/demo.md', reference)
    ));
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(false);
    const [dirtyPaths, setDirtyPaths] = React.useState<Set<string>>(() => new Set());

    const openFile = React.useCallback((path: string) => {
        setWorkspace((current) => openDesktopFile(current, path, reference));
        setPickerOpen(false);
        setMachinePickerOpen(false);
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
        setMachinePickerOpen(false);
    }, []);
    const openMachineFile = React.useCallback((path: string) => {
        setWorkspace((current) => openDesktopFile(current, path, {
            machineId: 'machine-2', source: 'machine',
        }));
        setMachinePickerOpen(false);
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
            references={workspace.references}
            dirtyPaths={dirtyPaths}
            pickerOpen={pickerOpen}
            machinePickerOpen={machinePickerOpen}
            compact={compact}
            picker={(
                <div data-testid="file-picker">
                    <button onClick={() => openFile('/workspace/demo.md')}>Open demo.md</button>
                    <button onClick={() => openFile('/workspace/second.md')}>Open second.md</button>
                </div>
            )}
            machinePicker={(
                <div data-testid="machine-picker">
                    <button onClick={() => openMachineFile('/workspace/remote.md')}>Open remote.md</button>
                </div>
            )}
            onSelect={selectFile}
            onRequestClose={closeFile}
            onFileDeleted={handleFileDeleted}
            onOpenPicker={() => {
                setMachinePickerOpen(false);
                setPickerOpen(true);
            }}
            onOpenMachinePicker={() => {
                setPickerOpen(false);
                setMachinePickerOpen(true);
            }}
            onClosePicker={() => {
                setPickerOpen(false);
                setMachinePickerOpen(false);
            }}
            onDirtyChange={handleDirtyChange}
        />
    );
}

function ZeroTabMachineWorkspaceDemo() {
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(false);
    return (
        <div data-testid="zero-tab-machine-workspace" style={{ width: 390, height: 320 }}>
            <button onClick={() => setMachinePickerOpen(true)}>Open Machine Workspace</button>
            {machinePickerOpen ? (
                <DesktopFileWorkspace
                    sessionId="ordinary-session"
                    paths={[]}
                    activePath={null}
                    dirtyPaths={new Set()}
                    pickerOpen={false}
                    machinePickerOpen
                    compact
                    picker={null}
                    machinePicker={<div data-testid="zero-tab-machine-picker">Machine files</div>}
                    onSelect={() => undefined}
                    onRequestClose={() => undefined}
                    onFileDeleted={() => undefined}
                    onOpenPicker={() => undefined}
                    onOpenMachinePicker={() => undefined}
                    onClosePicker={() => setMachinePickerOpen(false)}
                    onDirtyChange={() => undefined}
                />
            ) : null}
        </div>
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
        <ZeroTabMachineWorkspaceDemo />
    </div>,
);
