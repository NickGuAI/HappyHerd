import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { DesktopFileWorkspace, DesktopFileWorkspaceSplit } from '@/components/DesktopFileWorkspace';
import { FilesSidebar, type SidebarMode } from '@/components/FilesSidebar';
import {
    closeDesktopFile,
    EMPTY_DESKTOP_FILE_WORKSPACE,
    openDesktopFile,
    openDesktopLocalhost,
    selectDesktopFile,
} from '@/components/desktopFileWorkspaceModel';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import { useLocalSetting } from '@/sync/storage';
import { MachineWorkspaceBrowser } from '../../app/(app)/workspace';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { WorkspaceLinkPressContext } from '@/-session/workspaceLinkNavigation';

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

function CollapsedNavigationHeaderDemo() {
    return (
        <div
            data-testid="collapsed-navigation-header-demo"
            style={{ position: 'relative', display: 'flex', width: 800, height: 80 }}
        >
            <SidebarNavigator />
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
}: {
    compact: boolean;
}) {
    const reference = { machineId: 'machine-1', source: 'session' as const };
    const [workspace, setWorkspace] = React.useState(() => (
        openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/workspace/demo.md', reference)
    ));
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(false);
    const [dirtyPaths, setDirtyPaths] = React.useState<Set<string>>(() => new Set());

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
            machinePickerOpen={machinePickerOpen}
            compact={compact}
            machinePicker={(
                <div data-testid="machine-picker" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                    <MachineWorkspaceBrowser
                        embedded
                        initialMachineId="machine-2"
                        initialPath="/machine-root"
                        workspaceContextSessionId="ordinary-session"
                        onFilePress={openMachineFile}
                    />
                </div>
            )}
            onSelect={selectFile}
            onRequestClose={closeFile}
            onFileDeleted={handleFileDeleted}
            onOpenMachinePicker={() => setMachinePickerOpen(true)}
            onClosePicker={() => setMachinePickerOpen(false)}
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
                    onOpenWorkspace={() => {
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
                    machinePickerOpen={machinePickerOpen}
                    compact={false}
                    machinePicker={(
                        <div data-testid="production-machine-picker" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                            <MachineWorkspaceBrowser
                                embedded
                                initialMachineId="machine-2"
                                initialPath="/machine-root"
                                workspaceContextSessionId="ordinary-session"
                                onFilePress={openMachineFile}
                            />
                        </div>
                    )}
                    onSelect={(path) => setWorkspace((current) => selectDesktopFile(current, path))}
                    onRequestClose={(path) => setWorkspace((current) => closeDesktopFile(current, path))}
                    onFileDeleted={() => undefined}
                    onOpenMachinePicker={() => setMachinePickerOpen(true)}
                    onClosePicker={() => setMachinePickerOpen(false)}
                    onDirtyChange={() => undefined}
                />
            </div>
        </div>
    );
}

function ZeroTabWorkspaceDemo() {
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(false);
    return (
        <div data-testid="zero-tab-workspace" style={{ width: 390, height: 320 }}>
            <button onClick={() => setMachinePickerOpen(true)}>Open Workspace</button>
            {machinePickerOpen ? (
                <DesktopFileWorkspace
                    sessionId="ordinary-session"
                    paths={[]}
                    activePath={null}
                    dirtyPaths={new Set()}
                    machinePickerOpen
                    compact
                    machinePicker={(
                        <div data-testid="zero-tab-machine-picker" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                            <MachineWorkspaceBrowser
                                embedded
                                initialMachineId="machine-2"
                                initialPath="/machine-root"
                                workspaceContextSessionId="ordinary-session"
                                onFilePress={() => setMachinePickerOpen(false)}
                            />
                        </div>
                    )}
                    onSelect={() => undefined}
                    onRequestClose={() => undefined}
                    onFileDeleted={() => undefined}
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

function InteractiveHtmlWorkspaceDemo({ compact, testId }: { compact: boolean; testId: string }) {
    const reference = { machineId: 'machine-1', source: 'session' as const };
    const [workspace, setWorkspace] = React.useState(() => {
        const withNotes = openDesktopFile(
            EMPTY_DESKTOP_FILE_WORKSPACE,
            '/workspace/notes.md',
            reference,
        );
        return openDesktopFile(withNotes, '/workspace/task.html', reference);
    });

    return (
        <div
            data-testid={testId}
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                width: compact ? 390 : 900,
                height: compact ? 844 : 520,
                overflow: 'hidden',
            }}
        >
            <DesktopFileWorkspace
                sessionId="ordinary-session"
                paths={workspace.paths}
                activePath={workspace.activePath}
                references={workspace.references}
                dirtyPaths={new Set()}
                compact={compact}
                onSelect={(path) => setWorkspace((current) => selectDesktopFile(current, path))}
                onRequestClose={(path) => setWorkspace((current) => closeDesktopFile(current, path))}
                onFileDeleted={() => undefined}
                onClosePicker={() => undefined}
                onDirtyChange={() => undefined}
            />
        </div>
    );
}

function LocalhostLiveWorkspaceDemo({ compact, testId }: { compact: boolean; testId: string }) {
    const [workspace, setWorkspace] = React.useState(EMPTY_DESKTOP_FILE_WORKSPACE);
    const [machinePickerOpen, setMachinePickerOpen] = React.useState(true);

    return (
        <div
            data-testid={testId}
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                width: compact ? 390 : 900,
                height: compact ? 844 : 640,
                overflow: 'hidden',
            }}
        >
            <DesktopFileWorkspace
                sessionId={compact ? 'side-chat-mobile' : 'main-agent-desktop'}
                paths={workspace.paths}
                activePath={workspace.activePath}
                references={workspace.references}
                dirtyPaths={new Set()}
                machinePickerOpen={machinePickerOpen}
                compact={compact}
                machinePicker={(
                    <MachineWorkspaceBrowser
                        embedded
                        initialMachineId="machine-2"
                        initialPath="/machine-root"
                        workspaceContextSessionId={compact ? 'side-chat-mobile' : 'main-agent-desktop'}
                        onFilePress={() => undefined}
                        onLocalhostUrlPress={({ machineId, url }) => {
                            setWorkspace((current) => openDesktopLocalhost(current, machineId, url));
                            setMachinePickerOpen(false);
                        }}
                    />
                )}
                onSelect={(path) => setWorkspace((current) => selectDesktopFile(current, path))}
                onRequestClose={(path) => setWorkspace((current) => closeDesktopFile(current, path))}
                onFileDeleted={() => undefined}
                onOpenMachinePicker={() => setMachinePickerOpen(true)}
                onClosePicker={() => setMachinePickerOpen(false)}
                onDirtyChange={() => undefined}
            />
        </div>
    );
}

function FileReviewWorkspaceDemo({
    compact,
    testId,
    initialSurface = 'markdown',
}: {
    compact: boolean;
    testId: string;
    initialSurface?: 'markdown' | 'markdown-source' | 'canvas' | 'source';
}) {
    const reference = { machineId: 'machine-1', source: 'session' as const };
    const machineReference = { machineId: 'machine-2', source: 'machine' as const };
    const [workspace, setWorkspace] = React.useState(() => {
        const markdown = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/workspace/demo.md', reference);
        const canvas = openDesktopFile(markdown, '/workspace/review.canvas', reference);
        const source = openDesktopFile(canvas, '/workspace/review.ts', reference);
        const machineMarkdown = openDesktopFile(source, '/machine-root/machine.md', machineReference);
        const markdownSource = openDesktopFile(machineMarkdown, '/workspace/source.md', { ...reference, line: 1 });
        return {
            ...markdownSource,
            activePath: initialSurface === 'canvas'
                ? canvas.activePath
                : initialSurface === 'source'
                    ? source.activePath
                    : initialSurface === 'markdown-source' ? markdownSource.activePath : markdown.activePath,
        };
    });

    return (
        <div
            data-testid={testId}
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                width: compact ? 390 : 900,
                height: compact ? 844 : 640,
                overflow: 'hidden',
            }}
        >
            <DesktopFileWorkspace
                sessionId="ordinary-session"
                paths={workspace.paths}
                activePath={workspace.activePath}
                references={workspace.references}
                dirtyPaths={new Set()}
                compact={compact}
                onSelect={(path) => setWorkspace((current) => selectDesktopFile(current, path))}
                onRequestClose={(path) => setWorkspace((current) => closeDesktopFile(current, path))}
                onFileDeleted={() => undefined}
                onClosePicker={() => undefined}
                onDirtyChange={() => undefined}
            />
        </div>
    );
}

/** Reply links enter the same production Workspace and tab state as a session. */
function ReviewNavigationWorkspaceDemo({ compact }: { compact: boolean }) {
    const [workspace, setWorkspace] = React.useState(EMPTY_DESKTOP_FILE_WORKSPACE);
    return (
        <WorkspaceLinkPressContext.Provider value={(route) => {
            const params = route.params;
            setWorkspace((current) => openDesktopFile(current, params.absolutePath, {
                machineId: params.machineId,
                source: 'session',
                line: Number(params.line),
            }));
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', height: compact ? 844 : 900, width: compact ? 390 : 1100 }}>
                <MarkdownView
                    markdown="[Open line 160](/workspace/navigation.ts:160) · [Open line 200](/workspace/navigation.ts:200)"
                    sessionId="ordinary-session"
                    enableWorkspaceLinks
                />
                <DesktopFileWorkspace
                    sessionId="ordinary-session"
                    paths={workspace.paths}
                    activePath={workspace.activePath}
                    references={workspace.references}
                    dirtyPaths={new Set()}
                    compact={compact}
                    onSelect={(path) => setWorkspace((current) => selectDesktopFile(current, path))}
                    onRequestClose={(path) => setWorkspace((current) => closeDesktopFile(current, path))}
                    onFileDeleted={() => undefined}
                    onClosePicker={() => undefined}
                    onDirtyChange={() => undefined}
                />
            </div>
        </WorkspaceLinkPressContext.Provider>
    );
}

declare global {
    interface Window {
        __DELETE_RPC_COUNT__?: number;
        __WORKSPACE_FILE_DELETED_COUNT__?: number;
        __MACHINE_DIRECTORY_CALLS__?: Array<{ machineId: string; path: string; depth: number }>;
        __MACHINE_READ_CALLS__?: Array<{ machineId: string; path: string }>;
        __WORKSPACE_FEEDBACK_CALLS__?: Array<{
            sessionId: string;
            text: string;
            options: { displayText: string };
        }>;
        __WORKSPACE_FEEDBACK_FAILURE_COUNT__?: number;
        __SESSION_WRITE_CALLS__?: Array<{ path: string; content: string }>;
        __SESSION_TITLE_PRESS_COUNT__?: number;
        __WORKSPACE_LIVE_RPC_CALLS__?: Array<{ machineId: string; method: string; url: string }>;
    }
}

const interactiveHtmlSurface = new URLSearchParams(window.location.search).get('interactive-html');
const fileReviewSurface = new URLSearchParams(window.location.search).get('file-review');
const localhostLiveSurface = new URLSearchParams(window.location.search).get('localhost-live');
const reviewNavigationSurface = new URLSearchParams(window.location.search).get('review-navigation');

createRoot(document.getElementById('root')!).render(reviewNavigationSurface ? (
    <ReviewNavigationWorkspaceDemo compact={reviewNavigationSurface === 'mobile'} />
) : localhostLiveSurface ? (
    <LocalhostLiveWorkspaceDemo
        compact={localhostLiveSurface === 'mobile'}
        testId={localhostLiveSurface === 'mobile' ? 'localhost-live-mobile' : 'localhost-live-desktop'}
    />
) : fileReviewSurface ? (
    <FileReviewWorkspaceDemo
        compact={fileReviewSurface.startsWith('mobile')}
        initialSurface={fileReviewSurface === 'mobile-canvas'
            ? 'canvas'
            : fileReviewSurface === 'mobile-source'
                ? 'source'
                : fileReviewSurface.endsWith('markdown-source') ? 'markdown-source' : 'markdown'}
        testId={fileReviewSurface.startsWith('mobile') ? 'file-review-mobile' : 'file-review-desktop'}
    />
) : interactiveHtmlSurface ? (
    <InteractiveHtmlWorkspaceDemo
        compact={interactiveHtmlSurface === 'mobile'}
        testId={interactiveHtmlSurface === 'mobile'
            ? 'interactive-html-workspace-mobile'
            : 'interactive-html-workspace-wide'}
    />
) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <CollapsedNavigationHeaderDemo />
        <IntegratedDesktopDemo />
        <FileWorkspaceDemo compact={false} testId="wide-file-workspace" />
        <FileWorkspaceDemo compact testId="narrow-file-workspace" />
        <ZeroTabWorkspaceDemo />
        <ProductionDesktopWorkspaceEntryPointsDemo />
    </div>
));
