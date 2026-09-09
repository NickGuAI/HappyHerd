export const NEW_SESSION_DESKTOP_MIN_WINDOW_WIDTH = 1100;
export const NEW_SESSION_SIDEBAR_MAX_WIDTH = 720;
export const NEW_SESSION_PANEL_ROW_FONT_SIZE = 16;
export const NEW_SESSION_PANEL_SECTION_FONT_SIZE = 13;
const COMMANDER_PICKER_MAX_HEIGHT = 320;
const COMMANDER_PICKER_VIEWPORT_RATIO = 0.45;

type NewSessionSidebarLayoutInput = {
    platform: 'web' | 'ios' | 'android' | 'macos' | 'windows';
    isMac: boolean;
    fileDiffsSidebarEnabled: boolean;
    zenMode: boolean;
    windowWidth: number;
};

export function getNewSessionSidebarLayout(input: NewSessionSidebarLayoutInput) {
    const canShowSidebar = input.fileDiffsSidebarEnabled
        && (input.isMac || input.platform === 'web')
        && input.windowWidth >= NEW_SESSION_DESKTOP_MIN_WINDOW_WIDTH;
    const showSidebar = canShowSidebar && !input.zenMode;
    // Keep the existing 30%-based response to window size, but make the
    // approved panel twice as wide at each desktop width. Below the 1100px
    // gate the sidebar remains hidden, so the wider minimum never consumes a
    // narrow layout.
    const sidebarWidth = Math.min(
        Math.max(Math.floor(input.windowWidth * 0.3), 250) * 2,
        NEW_SESSION_SIDEBAR_MAX_WIDTH,
    );

    return { canShowSidebar, showSidebar, sidebarWidth };
}

export function getNewSessionCommanderPickerOptionListMaxHeight(input: {
    platform: NewSessionSidebarLayoutInput['platform'];
    embedded: boolean;
    windowHeight: number;
}): number | undefined {
    if (input.platform !== 'web' || input.embedded) {
        return undefined;
    }

    return Math.min(
        COMMANDER_PICKER_MAX_HEIGHT,
        Math.floor(input.windowHeight * COMMANDER_PICKER_VIEWPORT_RATIO),
    );
}
