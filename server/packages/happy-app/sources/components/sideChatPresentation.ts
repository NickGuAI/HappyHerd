export const SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH = 1100;

export type SideChatSurface = 'sidebar' | 'fullscreen';

export function resolveSessionSidebarPresentation(input: {
    platform: string;
    runningOnMac: boolean;
    windowWidth: number;
    zenMode: boolean;
    workspaceLinkPanelOpen: boolean;
    fileDiffsSidebarEnabled: boolean;
    canUseFilePanels: boolean;
}): {
    fileSidebarAvailable: boolean;
    sideChatSidebarAvailable: boolean;
    sideChatSurface: SideChatSurface;
} {
    const wideSidebarFrame = (input.platform === 'web' || input.runningOnMac)
        && input.windowWidth >= SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH;
    const sideChatSidebarAvailable = wideSidebarFrame;

    return {
        fileSidebarAvailable: wideSidebarFrame
            && input.fileDiffsSidebarEnabled
            && input.canUseFilePanels,
        sideChatSidebarAvailable,
        // Side chats intentionally do not inherit the file-diff feature gate:
        // externally created children must remain reachable on every client.
        sideChatSurface: sideChatSidebarAvailable
            && !input.zenMode
            && !input.workspaceLinkPanelOpen
            ? 'sidebar'
            : 'fullscreen',
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
}): boolean {
    return input.sideChatCount > 0
        && input.isLandscape
        && input.deviceType === 'phone'
        && input.platform !== 'web';
}
