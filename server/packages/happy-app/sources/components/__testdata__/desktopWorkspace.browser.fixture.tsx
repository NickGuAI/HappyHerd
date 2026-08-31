import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { DesktopFileWorkspace, DesktopFileWorkspaceSplit } from '@/components/DesktopFileWorkspace';
import { FilesSidebar, type SidebarMode } from '@/components/FilesSidebar';
import {
    closeDesktopFile,
    EMPTY_DESKTOP_FILE_WORKSPACE,
    openDesktopFile,
    selectDesktopFile,
} from '@/components/desktopFileWorkspaceModel';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import { useLocalSetting } from '@/sync/storage';
import { MachineWorkspaceBrowser } from '../../app/(app)/workspace';

function MainAgentChatProbe() {
    const [mountId] = React.useState(() => `mount-${Math.random()}`);
    const [draft, setDraft] = React.useState('retained draft');
    return (
        <div
            data-testid="main-agent-chat"
            data-mount-id={mountId}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}
        >
            <textarea
                data-testid="main-agent-composer-draft"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <div data-testid="main-agent-chat-scroll" style={{ overflowY: 'auto', height: 220 }}>
                <div style={{ height: 1000 }}>Main Agent chat remains mounted</div>
            </div>
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
                workspace={<FileWorkspaceContent compact={false} />}
                fallback={null}
            >
                <MainAgentChatProbe />
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

function FileWorkspaceContent({
    compact,
    initialSurface = 'file',
}: {
    compact: boolean;
    initialSurface?: 'file' | 'chat' | 'machine';
}) {
    const reference = { machineId: 'machine-1', source: 'session' as const };
    const [workspace, setWorkspace] = React.useState(() => (
        openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/workspace/demo.md', reference)
    ));
    const [pickerOpen, setPickerOpen] = React.useState(initialSurface === 'chat');
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(initialSurface === 'machine');
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
    const openMachineFile = React.useCallback(({ machineId, path }: { machineId: string; path: string }) => {
        setWorkspace((current) => openDesktopFile(current, path, {
            machineId, source: 'machine',
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
                <div data-testid="machine-picker" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                    <MachineWorkspaceBrowser
                        embedded
                        initialMachineId="machine-2"
                        initialPath="/machine-root"
                        onFilePress={openMachineFile}
                    />
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

function ProductionDesktopWorkspaceEntryPointsDemo() {
    const reference = { machineId: 'machine-1', source: 'session' as const };
    const [workspace, setWorkspace] = React.useState(() => (
        openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/workspace/demo.md', reference)
    ));
    const [openPanels, setOpenPanels] = React.useState<SidebarMode[]>([]);
    const [activePanel, setActivePanel] = React.useState<SidebarMode | null>(null);
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(false);

    const closePanels = React.useCallback(() => {
        setOpenPanels([]);
        setActivePanel(null);
    }, []);
    const openSessionFile = React.useCallback((path: string) => {
        setWorkspace((current) => openDesktopFile(current, path, reference));
        closePanels();
    }, [closePanels]);
    const openMachineFile = React.useCallback(({ machineId, path }: { machineId: string; path: string }) => {
        setWorkspace((current) => openDesktopFile(current, path, { machineId, source: 'machine' }));
        setMachinePickerOpen(false);
        closePanels();
    }, [closePanels]);
    const openPanel = React.useCallback((panel: SidebarMode) => {
        setOpenPanels((current) => current.includes(panel) ? current : [...current, panel]);
        setActivePanel(panel);
        setMachinePickerOpen(false);
    }, []);

    return (
        <div data-testid="desktop-workspace-entry-points" style={{ display: 'flex', width: 900, height: 380 }}>
            <div data-testid="production-files-sidebar" style={{ width: 280, minWidth: 0 }}>
                <FilesSidebar
                    sessionId="ordinary-session"
                    selectedPath={workspace.activePath}
                    openPanels={openPanels}
                    activePanel={activePanel}
                    onOpenPanel={openPanel}
                    onSelectPanel={setActivePanel}
                    onClosePanel={(panel) => {
                        setOpenPanels((current) => current.filter((candidate) => candidate !== panel));
                        setActivePanel((current) => current === panel ? null : current);
                    }}
                    onAllFilesFilePress={openSessionFile}
                    onAllFilesFileAttach={() => undefined}
                    onOpenMachineWorkspace={() => {
                        closePanels();
                        setMachinePickerOpen(true);
                    }}
                    canOpenFilePanels
                    sideChats={[]}
                    activeSideChatId={null}
                    onSelectSideChat={() => undefined}
                    onCloseSideChat={() => undefined}
                    creatingSideChat={false}
                    canCreateSideChat={false}
                    onCreateSideChat={async () => false}
                />
            </div>
            <div data-testid="production-desktop-file-workspace" style={{ flex: 1, minWidth: 0 }}>
                <DesktopFileWorkspace
                    sessionId="ordinary-session"
                    paths={workspace.paths}
                    activePath={workspace.activePath}
                    references={workspace.references}
                    dirtyPaths={new Set()}
                    pickerOpen={false}
                    machinePickerOpen={machinePickerOpen}
                    compact={false}
                    picker={null}
                    machinePicker={(
                        <div data-testid="production-machine-picker" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                            <MachineWorkspaceBrowser
                                embedded
                                initialMachineId="machine-2"
                                initialPath="/machine-root"
                                onFilePress={openMachineFile}
                            />
                        </div>
                    )}
                    onSelect={(path) => setWorkspace((current) => selectDesktopFile(current, path))}
                    onRequestClose={(path) => setWorkspace((current) => closeDesktopFile(current, path))}
                    onFileDeleted={() => undefined}
                    onOpenPicker={() => undefined}
                    onOpenMachinePicker={() => setMachinePickerOpen(true)}
                    onClosePicker={() => setMachinePickerOpen(false)}
                    onDirtyChange={() => undefined}
                />
            </div>
        </div>
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
                    machinePicker={(
                        <div data-testid="zero-tab-machine-picker" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                            <MachineWorkspaceBrowser
                                embedded
                                initialMachineId="machine-2"
                                initialPath="/machine-root"
                                onFilePress={() => setMachinePickerOpen(false)}
                            />
                        </div>
                    )}
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
        __MACHINE_DIRECTORY_CALLS__?: Array<{ machineId: string; path: string; depth: number }>;
        __MACHINE_READ_CALLS__?: Array<{ machineId: string; path: string }>;
    }
}

createRoot(document.getElementById('root')!).render(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <IntegratedDesktopDemo />
        <FileWorkspaceDemo compact={false} testId="wide-file-workspace" />
        <FileWorkspaceDemo compact testId="narrow-file-workspace" />
        <ZeroTabMachineWorkspaceDemo />
        <ProductionDesktopWorkspaceEntryPointsDemo />
    </div>,
);
