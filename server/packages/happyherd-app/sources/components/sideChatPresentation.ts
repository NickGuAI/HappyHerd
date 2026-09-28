export const SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH = 1100;

export type SideChatSurface = 'sidebar' | 'fullscreen';

/**
 * How the right panel and the Workspace meet the chat: docked beside it, or
 * (below 1,100 px on Web, phones included) as a sheet that slides in over it.
 */
export type RightPanelPresentation = 'docked' | 'overlay';

export function resolveSessionSidebarPresentation(input: {
    platform: string;
    runningOnMac: boolean;
    windowWidth: number;
    zenMode: boolean;
    workspaceLinkPanelOpen: boolean;
    canUseFilePanels: boolean;
}): {
    fileSidebarAvailable: boolean;
    sideChatSidebarAvailable: boolean;
    sideChatSurface: SideChatSurface;
    rightPanelPresentation: RightPanelPresentation;
} {
    const wideSidebarFrame = (input.platform === 'web' || input.runningOnMac)
        && input.windowWidth >= SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH;
    // Below the wide frame, Web keeps the same panels as a sheet over the chat
    // (UI overhaul). Phones share it: Side chats, Changes and the Workspace
    // slide in from the right instead of opening full screen.
    const overlaySidebarFrame = input.platform === 'web'
        && input.windowWidth < SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH;
    const sidebarFrame = wideSidebarFrame || overlaySidebarFrame;
    const sideChatSidebarAvailable = sidebarFrame;

    return {
        fileSidebarAvailable: sidebarFrame
            && input.canUseFilePanels,
        sideChatSidebarAvailable,
        // Externally created children remain reachable even when the current
        // session cannot expose file panels.
        sideChatSurface: sideChatSidebarAvailable
            && !input.zenMode
            && !input.workspaceLinkPanelOpen
            ? 'sidebar'
            : 'fullscreen',
        rightPanelPresentation: overlaySidebarFrame ? 'overlay' : 'docked',
    };
}

export function resolveActiveSideChatId(
    sessionIds: readonly string[],
    requestedId: string | null,
): string | null {
    if (requestedId && sessionIds.includes(requestedId)) {
        return requestedId;
    }
    return sessionIds[sessionIds.length - 1] ?? null;
}

export function resolveSideChatSelectionAfterClose(
    sessionIds: readonly string[],
    requestedActiveId: string | null,
    closingId: string,
): string | null {
    const activeId = resolveActiveSideChatId(sessionIds, requestedActiveId);
    if (activeId !== closingId) {
        return activeId;
    }

    const closingIndex = sessionIds.indexOf(closingId);
    if (closingIndex === -1) {
        return activeId;
    }
    return sessionIds[closingIndex - 1]
        ?? sessionIds[closingIndex + 1]
        ?? null;
}

export function shouldShowLandscapeSideChatAccess(input: {
    platform: string;
    deviceType: string;
    isLandscape: boolean;
    sideChatCount: number;
    canCreateSideChat: boolean;
}): boolean {
    return (input.sideChatCount > 0 || input.canCreateSideChat)
        && input.isLandscape
        && input.deviceType === 'phone'
        && input.platform !== 'web';
}
